import { App } from '@capacitor/app';

(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const welcome = $("welcome-screen"), playerScreen = $("player-screen");
  const audio = $("audio-element"), video = $("video-element");
  const FAVORITES_KEY = "meraj-video-player-favorites-v1";
  const state = {
    mode: "video", files: [], index: 0, objectUrls: [], allAudioFiles: [],
    favorites: loadFavorites(), favoritesOnly: false, shuffle: false,
    repeat: "off", speed: 1, lastPlayed: null, videoLocked: false, videoFit: "contain", lastVideoTap: 0, videoLibraryView: "videos", videoSearch: "", videoSelectedFolder: "", videoSeeking: false, thumbnailCache: new Map(), thumbnailObserver: null, controlsTimer: null, lastTouchAt: 0,
    audioBoost: 1, videoBoost: 1, audioGainContext: null, videoGainContext: null,
    audioGainNode: null, videoGainNode: null, audioSourceNode: null, videoSourceNode: null
  };

  // Web Audio gain allows software amplification above the device's normal 100% level.
  // It is capped at 200%; support depends on the browser/WebView audio implementation.
  function ensureGainGraph(kind) {
    const media = kind === "audio" ? audio : video;
    const contextKey = kind === "audio" ? "audioGainContext" : "videoGainContext";
    const sourceKey = kind === "audio" ? "audioSourceNode" : "videoSourceNode";
    const gainKey = kind === "audio" ? "audioGainNode" : "videoGainNode";
    try {
      if (!state[contextKey]) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return false;
        state[contextKey] = new AudioContextClass();
        state[sourceKey] = state[contextKey].createMediaElementSource(media);
        state[gainKey] = state[contextKey].createGain();
        state[sourceKey].connect(state[gainKey]);
        state[gainKey].connect(state[contextKey].destination);
      }
      if (state[contextKey].state === "suspended") state[contextKey].resume().catch(() => {});
      state[gainKey].gain.value = kind === "audio" ? state.audioBoost : state.videoBoost;
      return true;
    } catch (_) { return false; }
  }
  function setVolumeBoost(kind, percent) {
    const value = Math.max(0, Math.min(200, Number(percent) || 0));
    const multiplier = value / 100;
    if (kind === "audio") {
      state.audioBoost = multiplier;
      if ($("audio-volume-value")) $("audio-volume-value").textContent = `${value}%`;
      if (ensureGainGraph("audio")) state.audioGainNode.gain.value = multiplier;
      else audio.volume = Math.min(1, multiplier);
    } else {
      state.videoBoost = multiplier;
      if ($("video-volume-value")) $("video-volume-value").textContent = `${value}%`;
      if (ensureGainGraph("video")) state.videoGainNode.gain.value = multiplier;
      else video.volume = Math.min(1, multiplier);
    }
  }

  function loadFavorites() {
    try { return new Set(JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]")); }
    catch (_) { return new Set(); }
  }
  function saveFavorites() {
    try { localStorage.setItem(FAVORITES_KEY, JSON.stringify([...state.favorites])); } catch (_) {}
  }
  const fileKey = (file) => file?.uri ? `native|${file.uri}` : `${file.name}|${file.size}|${file.lastModified || 0}|${file.webkitRelativePath || ""}`;
  const formatTime = (seconds) => {
    if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
    return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
  };
  const formatBytes = (bytes) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  const activeMedia = () => state.mode === "audio" ? audio : video;
  // Android MediaStore returns content:// URIs. Keep these native URIs intact;
  // convertFileSrc is intended for filesystem paths and can turn a MediaStore
  // URI into an invalid localhost URL, leaving only the filename visible.
  const mediaPlaybackUrl = (uri) => {
    if (typeof uri !== "string") return uri;
    if (uri.startsWith("content://")) return uri;
    return window.Capacitor?.convertFileSrc ? window.Capacitor.convertFileSrc(uri) : uri;
  };
  const isFavorite = file => state.favorites.has(fileKey(file));
  const revokeUrls = () => { state.objectUrls.forEach(entry => URL.revokeObjectURL(typeof entry === "string" ? entry : entry.url)); state.objectUrls = []; };

  function openMode(mode) {
    if (mode === "video") { audio.pause(); audio.removeAttribute("src"); audio.load(); }
    state.mode = mode;
    welcome.classList.add("hidden"); playerScreen.classList.remove("hidden");
    $("player-title").textContent = mode === "audio" ? "Music Player" : "Video Player";
    $("player-kicker").textContent = mode === "audio" ? "YOUR MUSIC LIBRARY" : "YOUR VIDEO LIBRARY";
    $("player-subtitle").textContent = mode === "audio" ? "Listen to audio files stored on your device." : "Watch videos stored on your device.";
    $("empty-icon").textContent = mode === "audio" ? "♫" : "▶";
    $("empty-title").textContent = mode === "audio" ? "Your music starts here" : "Your videos start here";
    $("empty-description").textContent = mode === "audio" ? "Your device audio library will appear here after Android media scanning is connected." : "Your device video library will appear here after Android media scanning is connected.";
    updateScanMessage();
    $("audio-library-tools").classList.toggle("hidden", mode !== "audio");
    $("audio-controls").classList.toggle("hidden", mode !== "audio");
    renderMode();
  }
  function renderMode() {
    const isAudio = state.mode === "audio";
    $("artwork").classList.toggle("hidden", !isAudio);
    $("audio-controls").classList.toggle("hidden", !isAudio);
    video.classList.toggle("hidden", isAudio);
    $("video-frame").classList.toggle("hidden", isAudio);
    $("video-status").classList.toggle("hidden", isAudio || !state.files.length);
    setVideoLock(false);
    audio.pause(); video.pause();
    audio.removeAttribute("src"); video.removeAttribute("src");
    $("media-stage").classList.add("hidden");
    const hasFiles = isAudio ? state.allAudioFiles.length > 0 : state.files.length > 0;
    $("empty-library").classList.toggle("hidden", hasFiles);
    renderPlaylist();
  }
  function updateScanMessage(message) {
    $("scan-title").textContent = message || (state.mode === "audio" ? "Music library" : "Video library");
    $("scan-description").textContent = message
      ? "Media is read locally from your Android device."
      : "Tap Rescan to refresh media stored on this device.";
  }
  async function scanDeviceLibrary() {
    updateScanMessage("Checking media permission…");
    const plugins = window.Capacitor?.Plugins || {};
    const permission = plugins.MediaPermission;
    const scanner = plugins.MediaLibraryScanner;
    if (!permission || typeof permission.requestIfNeeded !== "function" || !scanner || typeof scanner.scan !== "function") {
      updateScanMessage("Native media integration is missing. Rebuild the APK from the updated project.");
      return;
    }
    try {
      const permissionResult = await permission.requestIfNeeded();
      if (!permissionResult?.granted) {
        updateScanMessage("Permission denied. Allow Music and videos in Android App settings, then tap Rescan.");
        return;
      }
      updateScanMessage("Scanning device media…");
      const result = await scanner.scan({ type: state.mode });
      const items = Array.isArray(result?.items) ? result.items : [];
      const normalized = items.map(item => ({
        ...item,
        nativeMedia: true,
        lastModified: 0,
        webkitRelativePath: item.relativePath || "Device files"
      }));
      if (state.mode === "audio") {
        state.allAudioFiles = normalized;
        state.files = currentAudioList();
        state.index = 0;
        rebuildFolderFilter();
        renderPlaylist();
      } else {
        revokeUrls();
        state.files = normalized;
        state.index = 0;
        state.videoSelectedFolder = "";
        renderPlaylist();
      }
      if (normalized.length) {
        $("empty-library").classList.add("hidden");
        $("media-stage").classList.add("hidden");
        updateScanMessage(`Scan complete · ${normalized.length} ${state.mode === "audio" ? "audio files" : "videos"} found`);
        if (state.mode === "audio") playIndex(0, false);
        else { $("media-stage").classList.add("hidden"); $("empty-library").classList.add("hidden"); }
      } else {
        $("media-stage").classList.add("hidden");
        $("empty-library").classList.remove("hidden");
        $("empty-title").textContent = state.mode === "audio" ? "No audio files found" : "No videos found";
        $("empty-description").textContent = "Add media to your device, then tap Rescan.";
        updateScanMessage("No matching media found");
      }
    } catch (error) {
      console.error("Media scan failed", error);
      updateScanMessage("Could not scan media. Check Android app permissions and tap Rescan.");
    }
  }

  function setAudioLibrary(files, replace = false) {
    const incoming = Array.from(files || []).filter(f => f && f.size >= 0);
    if (!incoming.length) return;
    if (replace) state.allAudioFiles = [];
    const seen = new Set(state.allAudioFiles.map(fileKey));
    for (const file of incoming) {
      if (!seen.has(fileKey(file))) { state.allAudioFiles.push(file); seen.add(fileKey(file)); }
    }
    state.mode = "audio";
    state.files = currentAudioList();
    rebuildFolderFilter();
    renderPlaylist();
    if (state.files.length) {
      $("empty-library").classList.add("hidden");
      $("media-stage").classList.remove("hidden");
      playIndex(0, false);
    }
  }
  function currentAudioList() {
    let list = state.allAudioFiles.slice();
    const folder = $("folder-filter")?.value || "__all__";
    if (folder !== "__all__") {
      list = list.filter(f => getFolder(f) === folder);
    }
    if (state.favoritesOnly) list = list.filter(isFavorite);
    return list;
  }
  function getFolder(file) {
    if (file?.relativePath) return String(file.relativePath).replace(/\/$/, "") || "Device files";
    const path = file.webkitRelativePath || "";
    if (!path.includes("/")) return "Device files";
    const pieces = path.split("/");
    return pieces.length > 2 ? pieces.slice(0, -1).join("/") : pieces[0];
  }
  function rebuildFolderFilter() {
    const select = $("folder-filter"), old = select.value;
    const folders = [...new Set(state.allAudioFiles.map(getFolder))].sort((a,b) => a.localeCompare(b));
    select.replaceChildren();
    const all = document.createElement("option"); all.value = "__all__"; all.textContent = "All songs"; select.appendChild(all);
    folders.forEach(folder => { const opt = document.createElement("option"); opt.value = folder; opt.textContent = folder; select.appendChild(opt); });
    if ([...select.options].some(o => o.value === old)) select.value = old;
  }
  function refreshAudioView(keepCurrent = true) {
    const currentKey = state.files[state.index] ? fileKey(state.files[state.index]) : null;
    state.files = currentAudioList();
    let index = currentKey ? state.files.findIndex(f => fileKey(f) === currentKey) : -1;
    if (index < 0) index = 0;
    state.index = Math.min(index, Math.max(0, state.files.length - 1));
    renderPlaylist();
    if (!state.files.length) {
      audio.pause(); audio.removeAttribute("src"); audio.load();
      $("media-stage").classList.add("hidden");
      $("empty-library").classList.remove("hidden");
      $("empty-title").textContent = state.favoritesOnly ? "No favorites yet" : "No songs in this view";
      $("empty-description").textContent = "Choose an audio folder or add songs to your library.";
      return;
    }
    $("empty-library").classList.add("hidden");
    if (keepCurrent) playIndex(state.index, false);
  }
  function loadVideoFiles(fileList) {
    const picked = Array.from(fileList || []).filter(f => f && f.size >= 0);
    if (!picked.length) return;
    audio.pause(); video.pause(); revokeUrls();
    state.files = picked; state.index = 0;
    state.objectUrls = picked.map(f => URL.createObjectURL(f));
    $("empty-library").classList.add("hidden");
    $("media-stage").classList.remove("hidden");
    playIndex(0, false);
  }
  async function playIndex(index, autoplay = true, forcedList = null) {
    const list = forcedList || state.files;
    if (!list.length) return;
    if (state.mode === "audio") {
      state.files = list;
      if (index < 0) index = list.length - 1;
      if (index >= list.length) index = 0;
      state.index = index;
      // Keep object URLs keyed by file so importing folders and favorites won't break playback.
      const file = state.files[state.index];
      let mediaUrl;
      if (file?.uri) {
        mediaUrl = mediaPlaybackUrl(file.uri);
      } else {
        let urlEntry = state.objectUrls.find(entry => entry.key === fileKey(file));
        if (!urlEntry) {
          urlEntry = { key: fileKey(file), url: URL.createObjectURL(file) };
          state.objectUrls.push(urlEntry);
        }
        mediaUrl = urlEntry.url;
      }
      audio.pause(); video.pause(); audio.src = mediaUrl; audio.playbackRate = state.speed; audio.load();
      ensureGainGraph("audio"); if (state.audioGainNode) state.audioGainNode.gain.value = state.audioBoost;
      $("current-name").textContent = file.name;
      $("current-type").textContent = `AUDIO FILE · ${formatBytes(file.size)}`;
      $("media-stage").classList.remove("hidden"); $("empty-library").classList.add("hidden");
      $("artwork").classList.remove("hidden"); video.classList.add("hidden");
      $("audio-controls").classList.remove("hidden"); $("video-status").classList.add("hidden");
      $("play-pause").textContent = "▶";
      $("favorite-current").textContent = isFavorite(file) ? "♥ Remove favorite" : "♡ Add to favorites";
      $("favorite-current").classList.toggle("is-favorite", isFavorite(file));
      renderPlaylist();
      if (autoplay) audio.play().catch(() => {});
      return;
    }
    state.index = (index + list.length) % list.length;
    const file = list[state.index];
    let videoUrl;
    if (file?.uri) {
      // MediaStore content:// URIs are not reliably playable by the WebView video element.
      // Copy to app cache only when the user actually requests playback.
      if (autoplay) {
        try {
          const scanner = window.Capacitor?.Plugins?.MediaLibraryScanner;
          if (!scanner || typeof scanner.preparePlayback !== "function") {
            throw new Error("Native video playback integration is missing. Rebuild the latest APK.");
          }
          $("video-status").textContent = "Preparing video for playback…";
          $("video-status").classList.remove("hidden");
          const prepared = await scanner.preparePlayback({ uri: file.uri, name: file.name, size: file.size });
          videoUrl = window.Capacitor?.convertFileSrc ? window.Capacitor.convertFileSrc(prepared.path) : prepared.path;
        } catch (error) {
          console.error("Could not prepare video", error);
          $("video-status").textContent = error?.message || "Could not open this video.";
          $("video-status").classList.remove("hidden");
          return;
        }
      } else {
        videoUrl = "";
      }
    } else {
      if (!state.objectUrls[state.index] || typeof state.objectUrls[state.index] !== "string") {
        state.objectUrls = list.map(f => URL.createObjectURL(f));
      }
      videoUrl = state.objectUrls[state.index];
    }
    audio.pause(); video.pause();
    state.videoFit = "contain"; applyVideoFit();
    audio.removeAttribute("src");
    if (videoUrl) {
      $("video-frame").classList.remove("hidden");
      video.classList.remove("hidden");
      video.style.display = "block";
      video.src = videoUrl;
      video.load();
    } else {
      video.removeAttribute("src");
      video.load();
    }
    ensureGainGraph("video"); if (state.videoGainNode) state.videoGainNode.gain.value = state.videoBoost;
    $("current-name").textContent = file.name;
    $("current-type").textContent = `VIDEO FILE · ${formatBytes(file.size)}`;
    $("media-stage").classList.remove("hidden"); $("empty-library").classList.add("hidden");
    document.body.classList.add("video-playing");
    $("artwork").classList.add("hidden"); $("audio-controls").classList.add("hidden");
    video.classList.remove("hidden"); $("video-status").classList.remove("hidden");
    renderPlaylist();
    if (autoplay) {
      try {
        await video.play();
        $("video-status").textContent = "Video playing";
        $("video-status").classList.remove("hidden");
      } catch (error) {
        console.error("Video play() was rejected", error, video.currentSrc);
        $("video-status").textContent = error?.message || "Video is ready but could not start. Tap Play again.";
        $("video-status").classList.remove("hidden");
      }
    }
  }
  function seekVideoBy(seconds) {
    if (!Number.isFinite(video.duration) || video.duration <= 0) return;
    video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + seconds));
  }
  function applyVideoFit() {
    video.style.objectFit = state.videoFit;
    const fitButton = $("video-overlay-fit");
    if (fitButton) {
      fitButton.textContent = state.videoFit === "contain" ? "⛶" : state.videoFit === "cover" ? "▣" : "↔";
      fitButton.setAttribute("aria-label", state.videoFit === "contain" ? "Fit video to screen" : state.videoFit === "cover" ? "Fill screen" : "Stretch video");
    }
  }
  function playVideoRelative(delta) {
    if (state.mode !== "video" || !state.files.length) return;
    const queue = state.videoSelectedFolder ? state.files.filter(f => getFolder(f) === state.videoSelectedFolder) : state.files;
    const current = state.files[state.index];
    const currentIndex = queue.findIndex(f => fileKey(f) === fileKey(current));
    const base = currentIndex >= 0 ? currentIndex : 0;
    const next = (base + delta + queue.length) % queue.length;
    const globalIndex = state.files.findIndex(f => fileKey(f) === fileKey(queue[next]));
    playIndex(globalIndex >= 0 ? globalIndex : 0, true);
  }
  async function toggleLandscape() {
    // Android WebView generally allows orientation locking only after a user gesture
    // and often only while the media frame is fullscreen. Enter fullscreen first.
    try {
      const isLandscape = Boolean(screen.orientation?.type?.startsWith("landscape"));
      if (!document.fullscreenElement) {
        const target = $("video-frame");
        if (target?.requestFullscreen) await target.requestFullscreen();
        else if (video.webkitEnterFullscreen) { video.webkitEnterFullscreen(); return; }
      }
      if (screen.orientation?.lock) await screen.orientation.lock(isLandscape ? "portrait" : "landscape");
    } catch (_) {
      if (!document.fullscreenElement) await toggleVideoFullscreen();
    }
  }
  function setVideoLock(locked) {
    state.videoLocked = Boolean(locked);
    const lockButton = $("video-overlay-lock");
    lockButton.textContent = state.videoLocked ? "🔓" : "🔒";
    lockButton.setAttribute("aria-label", state.videoLocked ? "Unlock controls" : "Lock controls");
    lockButton.setAttribute("title", state.videoLocked ? "Unlock controls" : "Lock controls");
    $("video-overlay-controls").classList.toggle("controls-locked", state.videoLocked);
    video.controls = false;
    if (state.videoLocked && state.controlsTimer) clearTimeout(state.controlsTimer);
  }
  async function toggleVideoFullscreen() {
    try {
      if (!document.fullscreenElement) {
        const target = $("video-frame");
        if (target.requestFullscreen) await target.requestFullscreen();
        else if (video.webkitEnterFullscreen) { video.webkitEnterFullscreen(); return; }
        try { if (screen.orientation && screen.orientation.lock) await screen.orientation.lock("landscape"); } catch (_) {}
      } else {
        await document.exitFullscreen();
        try { if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock(); } catch (_) {}
      }
    } catch (_) {
      if (video.webkitEnterFullscreen) { try { video.webkitEnterFullscreen(); } catch (_) {} }
    }
  }

  function playbackQueue() {
    if (state.mode !== "audio") return state.files;
    const folder = $("folder-filter").value;
    // Shuffle scope is either the selected current folder or the complete all-songs library.
    if (state.shuffleScope === "folder" && folder !== "__all__") {
      return state.allAudioFiles.filter(f => getFolder(f) === folder && (!state.favoritesOnly || isFavorite(f)));
    }
    return state.allAudioFiles.filter(f => !state.favoritesOnly || isFavorite(f));
  }
  function nextTrack() {
    if (state.mode !== "audio") return playIndex(state.index + 1, true);
    const queue = playbackQueue();
    if (!queue.length) return;
    const current = state.files[state.index];
    let next;
    if (state.shuffle && queue.length > 1) {
      const candidates = queue.filter(f => !current || fileKey(f) !== fileKey(current));
      next = candidates[Math.floor(Math.random() * candidates.length)];
    } else {
      const idx = queue.findIndex(f => current && fileKey(f) === fileKey(current));
      next = queue[(idx + 1 + queue.length) % queue.length];
    }
    state.files = queue;
    playIndex(Math.max(0, queue.findIndex(f => fileKey(f) === fileKey(next))), true, queue);
  }
  function previousTrack() {
    if (state.mode !== "audio") return playIndex(state.index - 1, true);
    if (audio.currentTime > 3) { audio.currentTime = 0; return; }
    const queue = playbackQueue();
    if (!queue.length) return;
    const current = state.files[state.index];
    const idx = queue.findIndex(f => current && fileKey(f) === fileKey(current));
    state.files = queue;
    playIndex((idx - 1 + queue.length) % queue.length, true, queue);
  }
  function renderVideoFolderStrip() {
    const strip = $("video-folder-strip");
    if (!strip || state.mode !== "video") return;
    const folders = [...new Set(state.files.map(getFolder))].sort((a,b) => a.localeCompare(b));
    strip.replaceChildren();
    folders.forEach(folder => { const chip=document.createElement("button"); chip.type="button"; chip.className=`folder-chip${state.videoSelectedFolder===folder ? " selected" : ""}`; chip.textContent=folder.split("/").filter(Boolean).pop() || folder; chip.title=folder; chip.addEventListener("click", () => { state.videoSelectedFolder=folder; state.videoLibraryView="videos"; updateVideoLibraryTabs(); renderPlaylist(); }); strip.appendChild(chip); });
    strip.classList.toggle("hidden", !folders.length);
    document.body.classList.toggle("has-selected-video-folder", Boolean(state.videoSelectedFolder));
  }
  async function loadNativeThumbnail(node, uri) {
    if (!node || !uri || node.dataset.thumbnailLoaded === "1") return;
    if (state.thumbnailCache.has(uri)) { applyThumbnail(node, state.thumbnailCache.get(uri)); return; }
    node.dataset.thumbnailLoaded = "1";
    try {
      const plugin = window.Capacitor?.Plugins?.MediaLibraryScanner;
      if (!plugin || typeof plugin.getThumbnail !== "function") return;
      const result = await plugin.getThumbnail({ uri });
      const data = result?.thumbnail || "";
      if (data) { state.thumbnailCache.set(uri, data); applyThumbnail(node, data); }
    } catch (e) { console.warn("Video thumbnail unavailable", e); }
  }
  function applyThumbnail(node, data) {
    if (!node || !data) return;
    node.style.backgroundImage = `url("${data}")`;
    node.style.backgroundSize = "cover";
    node.style.backgroundPosition = "center";
    node.querySelector(".thumb-film-icon")?.classList.add("thumb-icon-over-image");
  }

  function renderPlaylist() {
    const list = $("playlist");
    let shown = state.mode === "audio" ? currentAudioList() : state.files;
    if (state.mode === "video") {
      const q = state.videoSearch.trim().toLocaleLowerCase();
      if (q) shown = shown.filter(file => `${file.name || ""} ${getFolder(file)}`.toLocaleLowerCase().includes(q));
      if (state.videoLibraryView === "folders" && !state.videoSelectedFolder) {
        state.videoSelectedFolder = [...new Set(state.files.map(getFolder))].sort((a,b) => a.localeCompare(b))[0] || "";
      }
      if (state.videoSelectedFolder) shown = shown.filter(file => getFolder(file) === state.videoSelectedFolder);
      renderVideoFolderStrip();
      if (state.videoLibraryView === "folders" && !state.videoSelectedFolder) {
        const folderNames = [...new Set(shown.map(getFolder))].sort((a,b) => a.localeCompare(b));
        list.classList.add("folder-card-list");
        $("track-count").textContent = String(folderNames.length);
        list.replaceChildren();
        if (!folderNames.length) { const empty = document.createElement("div"); empty.className = "playlist-empty"; empty.textContent = "No folders found."; list.appendChild(empty); return; }
        folderNames.forEach(folder => { const filesInFolder = state.files.filter(file => getFolder(file) === folder); const card = document.createElement("button"); card.type = "button"; card.className = "folder-card"; card.innerHTML = '<span class="folder-card-icon">▤</span><span class="folder-card-copy"></span><span class="folder-card-arrow">›</span>'; card.querySelector(".folder-card-copy").textContent = folder; const count = document.createElement("small"); count.textContent = `${filesInFolder.length} videos`; card.querySelector(".folder-card-copy").appendChild(count); card.addEventListener("click", () => { state.videoSelectedFolder = folder; state.videoLibraryView = "videos"; $("video-search").value = ""; state.videoSearch = ""; updateVideoLibraryTabs(); renderPlaylist(); }); list.appendChild(card); }); return;
      }
    }
    list.classList.toggle("folder-card-list", false);
    $("track-count").textContent = String(shown.length);
    list.replaceChildren();
    if (!shown.length) {
      const empty = document.createElement("div"); empty.className = "playlist-empty";
      empty.textContent = state.mode === "audio" && state.favoritesOnly ? "No favorites yet. Tap ♡ on a song to save it." : "No media found. Tap Rescan to check your device.";
      list.appendChild(empty); return;
    }
    shown.forEach((file, i) => {
      const item = document.createElement("div");
      const active = state.mode === "audio"
        ? state.files[state.index] && fileKey(state.files[state.index]) === fileKey(file)
        : i === state.index;
      const isVideo = state.mode === "video";
      item.className = `playlist-item${active ? " active" : ""}${isVideo ? " video-library-card" : ""}`;

      if (isVideo) {
        // Explicit inline layout avoids legacy MP3 CSS rules collapsing video card content.
        item.style.cssText = "display:flex;flex-direction:row;align-items:stretch;position:relative;min-width:0;min-height:86px;height:auto;padding:0;overflow:hidden;border:1px solid #24464e;border-radius:13px;background:linear-gradient(110deg,#10232a,#0c171d);color:#f5f3ff;box-sizing:border-box;cursor:pointer;";
        const thumb = document.createElement("div");
        thumb.className = "video-card-thumb";
        thumb.setAttribute("aria-hidden", "true");
        thumb.style.cssText = "display:flex;align-items:center;justify-content:center;position:relative;width:112px;height:84px;min-height:84px;flex:0 0 112px;align-self:center;margin:7px;overflow:hidden;border-radius:9px;background:linear-gradient(145deg,#18363c 0%,#12252c 52%,#0c181e 100%);";
        thumb.innerHTML = '<span class="thumb-film-icon" style="display:grid;place-items:center;width:42px;height:42px;border-radius:50%;background:rgba(139,124,255,.22);border:1px solid rgba(177,166,255,.5);color:#fff;font-size:17px;">▶</span><span class="thumb-duration" style="position:absolute;right:7px;bottom:7px;padding:3px 6px;border-radius:5px;background:rgba(0,0,0,.65);color:#fff;font-size:9px;font-weight:700;letter-spacing:.06em;">VIDEO</span>';
        if (file.uri && file.nativeMedia) {
          thumb.dataset.mediaUri = file.uri;
          thumb.dataset.thumbnailPending = "1";
          thumb.style.background = "linear-gradient(145deg,#242943 0%,#171b2e 52%,#10121d 100%)";
          if (!state.thumbnailObserver && "IntersectionObserver" in window) {
            state.thumbnailObserver = new IntersectionObserver(entries => entries.forEach(entry => {
              if (!entry.isIntersecting) return;
              const node = entry.target; state.thumbnailObserver.unobserve(node);
              loadNativeThumbnail(node, node.dataset.mediaUri);
            }), { root: list, rootMargin: "180px" });
          }
          if (state.thumbnailObserver) state.thumbnailObserver.observe(thumb);
          else loadNativeThumbnail(thumb, file.uri);
        } else if (file instanceof Blob) {
          const localUrl = URL.createObjectURL(file);
          const image = document.createElement("video"); image.muted = true; image.preload = "metadata"; image.src = localUrl;
          image.addEventListener("loadeddata", () => { try { image.currentTime = Math.min(1, image.duration || 1); } catch (_) {} }, { once:true });
          image.addEventListener("seeked", () => { try { const c = document.createElement("canvas"); c.width=320; c.height=180; c.getContext("2d").drawImage(image,0,0,320,180); thumb.style.backgroundImage=`url(${c.toDataURL("image/jpeg",.75)})`; thumb.style.backgroundSize="cover"; } catch (_) {} URL.revokeObjectURL(localUrl); }, { once:true });
        }
        item.appendChild(thumb);
      }

      const button = document.createElement("button");
      button.className = "playlist-play";
      button.type = "button";
      button.textContent = active && !activeMedia().paused ? "Ⅱ" : "▶";
      button.setAttribute("aria-label", `Play ${file.name || "video"}`);
      button.addEventListener("click", e => {
        e.stopPropagation();
        if (active) {
          if (activeMedia().paused) activeMedia().play().catch(() => {});
          else activeMedia().pause();
        } else if (state.mode === "audio") {
          const queue = currentAudioList();
          playIndex(queue.findIndex(f => fileKey(f) === fileKey(file)), true, queue);
        } else playIndex(state.files.findIndex(f => fileKey(f) === fileKey(file)), true);
      });

      const info = document.createElement("div");
      info.className = isVideo ? "playlist-info video-card-info" : "playlist-info";
      if (isVideo) {
        info.style.cssText = "display:flex;flex-direction:column;justify-content:center;position:relative;box-sizing:border-box;width:auto;min-width:0;min-height:84px;flex:1 1 auto;padding:8px 10px 8px 3px;overflow:hidden;background:transparent;color:#f5f3ff;cursor:pointer;";
      }
      // Video rows have one click handler on the card only. Avoid nested handlers
      // calling playIndex twice, which can race native preparePlayback() and pause playback.
      if (!isVideo) info.addEventListener("click", () => {
        const queue = currentAudioList();
        playIndex(queue.findIndex(f => fileKey(f) === fileKey(file)), true, queue);
      });

      const name = document.createElement("div");
      name.className = "playlist-name";
      name.textContent = file.name || file.displayName || "Untitled video";
      if (isVideo) name.style.cssText = "display:block;visibility:visible;opacity:1;color:#f5f3ff;font-size:12px;font-weight:750;line-height:1.4;white-space:normal;overflow-wrap:anywhere;word-break:break-word;max-height:2.8em;overflow:hidden;";
      const meta = document.createElement("div");
      meta.className = "playlist-meta";
      meta.textContent = `${getFolder(file) || "On device"} · ${formatBytes(file.size)}`;
      if (isVideo) meta.style.cssText = "display:block;visibility:visible;opacity:1;color:#aeb0c8;font-size:10px;line-height:1.4;margin-top:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
      info.append(name, meta);

      if (isVideo) {
        const playBadge = document.createElement("span");
        playBadge.className = "video-card-play";
        playBadge.textContent = "▶";
        item.appendChild(info);
        item.addEventListener("click", e => {
          if (!e.target.closest("button")) playIndex(state.files.findIndex(f => fileKey(f) === fileKey(file)), true);
        });
      } else {
        item.append(button, info);
        const fav = document.createElement("button");
        fav.className = `favorite-toggle${isFavorite(file) ? " is-favorite" : ""}`;
        fav.type = "button";
        fav.textContent = isFavorite(file) ? "♥" : "♡";
        fav.title = isFavorite(file) ? "Remove favorite" : "Add favorite";
        fav.addEventListener("click", () => toggleFavorite(file));
        item.append(fav);
      }
      list.appendChild(item);
    });
  }
  function toggleFavorite(file) {
    const key = fileKey(file);
    if (state.favorites.has(key)) state.favorites.delete(key); else state.favorites.add(key);
    saveFavorites();
    if (state.mode === "audio") {
      $("favorite-current").textContent = state.files[state.index] && isFavorite(state.files[state.index]) ? "♥ Remove favorite" : "♡ Add to favorites";
      refreshAudioView(false);
    }
  }
  function updateModes() {
    $("shuffle-mode").classList.toggle("active", state.shuffle);
    $("shuffle-mode").textContent = state.shuffle ? "🔀" : "⤨";
    $("shuffle-mode").title = state.shuffle ? `Shuffle on · ${state.shuffleScope === "folder" ? "current folder" : "all songs"}` : "Shuffle off";
    $("shuffle-scope").value = state.shuffleScope;
    $("shuffle-mode").setAttribute("aria-label", $("shuffle-mode").title);
    $("repeat-mode").classList.toggle("active", state.repeat !== "off");
    $("repeat-mode").textContent = state.repeat === "one" ? "↻¹" : "↻";
    $("repeat-mode").title = state.repeat === "off" ? "Repeat off" : state.repeat === "all" ? "Repeat all" : "Repeat one";
    $("repeat-mode").setAttribute("aria-label", $("repeat-mode").title);
  }

  function updateVideoLibraryTabs() {
    const folders = state.videoLibraryView === "folders";
    document.body.classList.toggle("folders-view", folders);
    $("video-tab-all").classList.toggle("selected", !folders); $("video-tab-folders").classList.toggle("selected", folders);
    $("video-tab-all").setAttribute("aria-selected", String(!folders)); $("video-tab-folders").setAttribute("aria-selected", String(folders));
    $("bottom-library").classList.toggle("active", !folders); $("bottom-folders").classList.toggle("active", folders);
  }
  $("video-search").addEventListener("input", e => { state.videoSearch = e.target.value || ""; renderPlaylist(); });
  $("video-tab-all").addEventListener("click", () => { state.videoLibraryView = "videos"; state.videoSelectedFolder = ""; updateVideoLibraryTabs(); renderPlaylist(); });
  $("video-tab-folders").addEventListener("click", () => { state.videoLibraryView = "folders"; updateVideoLibraryTabs(); renderPlaylist(); });
  $("bottom-library").addEventListener("click", () => { document.body.classList.remove("video-playing"); state.videoLibraryView = "videos"; state.videoSelectedFolder = ""; updateVideoLibraryTabs(); renderPlaylist(); });
  $("bottom-folders").addEventListener("click", () => { document.body.classList.remove("video-playing"); state.videoLibraryView = "folders"; updateVideoLibraryTabs(); renderPlaylist(); });
  $("bottom-rescan").addEventListener("click", () => { document.body.classList.remove("video-playing"); scanDeviceLibrary(); });
  $("rescan-library-top").addEventListener("click", scanDeviceLibrary);
  $("choose-video").addEventListener("click", () => { openMode("video"); scanDeviceLibrary(); });
  $("back-home")?.addEventListener("click", () => {
    video.pause(); playerScreen.classList.add("hidden"); welcome.classList.remove("hidden");
  });
  $("rescan-library").addEventListener("click", scanDeviceLibrary);
  $("show-all-songs").addEventListener("click", () => {
    state.favoritesOnly = false;
    $("show-all-songs").classList.add("selected"); $("show-favorites").classList.remove("selected");
    refreshAudioView(false);
  });
  $("show-favorites").addEventListener("click", () => {
    state.favoritesOnly = true;
    $("show-favorites").classList.add("selected"); $("show-all-songs").classList.remove("selected");
    refreshAudioView(false);
  });
  $("folder-filter").addEventListener("change", () => {
    refreshAudioView(false);
    if (state.shuffleScope === "folder") updateModes();
  });
  $("favorite-current").addEventListener("click", () => {
    const file = state.files[state.index]; if (file && state.mode === "audio") toggleFavorite(file);
  });
  $("shuffle-mode").addEventListener("click", () => {
    state.shuffle = !state.shuffle;
    updateModes();
  });
  $("shuffle-scope").addEventListener("change", e => {
    state.shuffleScope = e.target.value === "folder" ? "folder" : "all";
    updateModes();
  });
  $("repeat-mode").addEventListener("click", () => {
    state.repeat = state.repeat === "off" ? "all" : state.repeat === "all" ? "one" : "off";
    updateModes();
  });
  $("playback-speed").addEventListener("change", e => {
    state.speed = Math.max(1, Math.min(2, Number(e.target.value) || 1));
    audio.playbackRate = state.speed;
    if ("defaultPlaybackRate" in audio) audio.defaultPlaybackRate = state.speed;
  });
  $("play-pause").addEventListener("click", () => {
    if (!state.files.length) return;
    if (audio.paused) audio.play().catch(() => {}); else audio.pause();
  });
  $("previous-track").addEventListener("click", previousTrack);
  $("next-track").addEventListener("click", nextTrack);
  // Audio boost controls are optional in the video-first library UI. Guard them so
  // a missing audio-only control cannot abort all player initialization.
  $("audio-volume-boost")?.addEventListener("input", e => setVolumeBoost("audio", e.target.value));
  $("video-overlay-lock").addEventListener("click", () => setVideoLock(!state.videoLocked));
  $("video-overlay-previous").addEventListener("click", () => playVideoRelative(-1));
  $("video-overlay-rewind").addEventListener("click", () => seekVideoBy(-15));
  $("video-overlay-forward").addEventListener("click", () => seekVideoBy(15));
  $("video-overlay-next").addEventListener("click", () => playVideoRelative(1));
  $("video-overlay-zoom").addEventListener("click", () => { state.videoFit = state.videoFit === "cover" ? "contain" : "cover"; applyVideoFit(); });
  $("video-overlay-landscape").addEventListener("click", toggleLandscape);
  $("video-overlay-play").addEventListener("click", () => { if (video.paused) video.play().catch(() => {}); else video.pause(); });
  $("video-overlay-fit").addEventListener("click", () => { state.videoFit = "contain"; applyVideoFit(); });
<<<<<<< HEAD
  $("video-overlay-fullscreen")?.addEventListener("click", toggleVideoFullscreen);
  $("video-overlay-volume")?.addEventListener("click", () => $("video-overlay-volume-panel").classList.toggle("hidden"));
  $("video-overlay-volume-slider")?.addEventListener("input", e => { video.volume = Math.max(0, Math.min(1, Number(e.target.value) / 100)); const volumeButton = $("video-overlay-volume"); if (volumeButton) volumeButton.textContent = video.volume === 0 ? "🔇" : "🔊"; });
=======
  $("video-overlay-fullscreen").addEventListener("click", toggleVideoFullscreen);
  $("video-overlay-volume").addEventListener("click", () => $("video-overlay-volume-panel").classList.toggle("hidden"));
  $("video-overlay-volume-slider").addEventListener("input", e => { video.volume = Math.max(0, Math.min(1, Number(e.target.value) / 100)); $("video-overlay-volume").textContent = video.volume === 0 ? "🔇" : "🔊"; });
>>>>>>> 9dfd25251da4f3919cd8c783f4dbc42c0528eba2
  const videoSeekbar = $("video-seekbar");
  // Keep the thumb under the user's finger while dragging; timeupdate must not
  // overwrite the range value until the gesture finishes.
  const beginVideoSeek = () => { state.videoSeeking = true; };
  const finishVideoSeek = () => { if (!state.videoSeeking) return; state.videoSeeking = false; if (Number.isFinite(video.duration) && video.duration > 0) video.currentTime = Number(videoSeekbar.value) / 1000 * video.duration; };
  videoSeekbar.addEventListener("pointerdown", beginVideoSeek, { passive: true });
  videoSeekbar.addEventListener("pointerup", finishVideoSeek, { passive: true });
  videoSeekbar.addEventListener("pointercancel", finishVideoSeek, { passive: true });
  videoSeekbar.addEventListener("touchstart", beginVideoSeek, { passive: true });
  videoSeekbar.addEventListener("touchend", finishVideoSeek, { passive: true });
  videoSeekbar.addEventListener("touchcancel", finishVideoSeek, { passive: true });
  videoSeekbar.addEventListener("change", finishVideoSeek);
  videoSeekbar.addEventListener("input", () => { if (state.videoSeeking && Number.isFinite(video.duration) && video.duration > 0) video.currentTime = Number(videoSeekbar.value) / 1000 * video.duration; });
  video.addEventListener("error", () => {
    const code = video.error?.code;
    const detail = code === 4 ? "This video format/codec is not supported by this Android device." : "Could not open this video. Check file access and format.";
    $("video-status").textContent = detail;
    $("video-status").classList.remove("hidden");
    console.error("Video playback error", video.error, video.currentSrc);
  });
  video.addEventListener("loadedmetadata", () => {
    $("video-status").textContent = `Playing video · ${formatTime(video.duration)}`;
  });
  video.addEventListener("play", () => { $("video-overlay-play").textContent = "Ⅱ"; $("video-overlay-play").setAttribute("aria-label", "Pause video"); });
  video.addEventListener("pause", () => { $("video-overlay-play").textContent = "▶"; $("video-overlay-play").setAttribute("aria-label", "Play video"); });
  // Detect vertical/Shorts-style videos and switch to an immersive portrait layout.
  video.addEventListener("loadedmetadata", () => {
    // Keep the video viewport visible and sized even when Android WebView reports
    // metadata before its first decoded frame. A collapsed/zero-height video can
    // otherwise play audio while the picture appears missing.
    const frame = $("video-frame");
    frame.classList.remove("hidden");
    video.classList.remove("hidden");
    video.style.display = "block";
    video.style.width = "100%";
    video.style.height = "100%";
    const isPortrait = video.videoHeight > video.videoWidth;
    // Keep video inside the regular player page; do not switch to a separate immersive page.
    frame.classList.toggle("video-portrait", isPortrait);
    frame.classList.toggle("video-landscape", !isPortrait);
    state.videoFit = "contain";
    applyVideoFit();
    const status = $("video-status");
    $("video-overlay-title").textContent = state.files[state.index]?.name || "Now playing";
    $("video-overlay-controls").classList.remove("hidden");
    positionVideoControls();
    $("video-total-time").textContent = formatTime(video.duration);
    if (status) status.textContent = `Video loaded · ${video.videoWidth}×${video.videoHeight} · ${formatTime(video.duration)}`;
  });
  video.addEventListener("loadeddata", () => {
    // Confirm a decoded video frame, not just an audio track, is available.
    const frame = $("video-frame");
    frame.classList.remove("hidden");
    video.classList.remove("hidden");
    if (video.videoWidth > 0 && video.videoHeight > 0) {
      $("video-status").textContent = `Video picture ready · ${video.videoWidth}×${video.videoHeight}`;
    }
  });
  video.addEventListener("waiting", () => {
    if (video.readyState < 3) $("video-status").textContent = "Loading video frames…";
  });
  video.addEventListener("dblclick", e => {
    if (state.videoLocked) { setVideoLock(false); showVideoControls(true); return; }
    const rect = video.getBoundingClientRect();
    seekVideoBy(e.clientX < rect.left + rect.width / 2 ? -10 : 10);
  });
  // Smooth, non-blocking touch behavior: do not preventDefault() on touchend,
  // because Android WebView may then cancel taps or interfere with vertical scrolling.
  const videoFrame = $("video-frame");
  function showVideoControls(show) {
    const controls = $("video-overlay-controls");
    if (!controls || state.videoLocked) return;
    const immersive = Boolean(document.fullscreenElement) || videoFrame.classList.contains("is-fullscreen");
    if (!immersive) { controls.classList.remove("hidden"); return; }
    controls.classList.toggle("hidden", !show);
    if (state.controlsTimer) clearTimeout(state.controlsTimer);
    state.controlsTimer = null;
    if (show) state.controlsTimer = setTimeout(() => {
      if (!state.videoLocked) controls.classList.add("hidden");
    }, 5000);
  }
  const videoOverlay = $("video-overlay-controls");
  if (videoOverlay && videoFrame.parentElement) videoFrame.parentElement.insertBefore(videoOverlay, $("track-details"));
  let lastFrameTap = 0;
  videoFrame.addEventListener("click", e => {
    if (e.target.closest(".video-overlay-controls")) return;
    const immersive = Boolean(document.fullscreenElement) || videoFrame.classList.contains("is-fullscreen");
    if (immersive) {
      if (state.videoLocked) return;
      showVideoControls($("video-overlay-controls").classList.contains("hidden"));
      return;
    }
    // Inline player: tapping the picture toggles playback; controls remain below it.
    if (e.target === video || e.target.closest(".video-element")) {
      const now = Date.now();
      if (now - lastFrameTap < 320) {
        const rect = video.getBoundingClientRect();
        seekVideoBy(e.clientX < rect.left + rect.width / 2 ? -15 : 15);
      } else if (video.paused) {
        video.play().catch(err => {
          const status = $("video-status");
          if (status) { status.textContent = err?.message || "Tap Play to start this video."; status.classList.remove("hidden"); }
        });
      } else {
        video.pause();
      }
      lastFrameTap = now;
    }
  });
  function positionVideoControls() {
    const frame = $("video-frame"), controls = $("video-overlay-controls");
    if (!frame || !controls) return;
    const immersive = Boolean(document.fullscreenElement) || frame.classList.contains("is-fullscreen");
    if (immersive) {
      if (controls.parentElement !== frame) frame.appendChild(controls);
      controls.classList.add("overlay-on-video");
    } else {
      if (controls.parentElement !== frame.parentElement) frame.parentElement.insertBefore(controls, $("track-details"));
      controls.classList.remove("overlay-on-video");
    }
  }
  document.addEventListener("fullscreenchange", () => {
    const frame = $("video-frame");
    if (frame) frame.classList.toggle("is-fullscreen", Boolean(document.fullscreenElement));
    positionVideoControls();
    if (document.fullscreenElement) showVideoControls(true);
  });
  screen.orientation?.addEventListener?.("change", () => {
    const frame = $("video-frame");
    if (frame && document.fullscreenElement) frame.classList.add("is-fullscreen");
    positionVideoControls();
  });

  $("seekbar").addEventListener("input", () => {
    if (Number.isFinite(audio.duration) && audio.duration > 0) audio.currentTime = (Number($("seekbar").value) / 1000) * audio.duration;
  });
  audio.addEventListener("timeupdate", () => {
    $("current-time").textContent = formatTime(audio.currentTime);
    $("duration").textContent = formatTime(audio.duration);
    $("seekbar").value = Number.isFinite(audio.duration) && audio.duration > 0 ? String(Math.round(audio.currentTime / audio.duration * 1000)) : "0";
  });
  audio.addEventListener("play", () => { $("play-pause").textContent = "Ⅱ"; $("play-pause").setAttribute("aria-label", "Pause"); renderPlaylist(); });
  audio.addEventListener("pause", () => { $("play-pause").textContent = "▶"; $("play-pause").setAttribute("aria-label", "Play"); renderPlaylist(); });
  audio.addEventListener("ended", () => {
    if (state.repeat === "one") { audio.currentTime = 0; audio.play().catch(() => {}); return; }
    const queue = playbackQueue();
    if (queue.length > 1 && (state.repeat === "all" || state.index < queue.length - 1 || state.shuffle)) nextTrack();
    else { $("play-pause").textContent = "▶"; }
  });
  video.addEventListener("loadedmetadata", () => {
    const d = Number.isFinite(video.duration) ? formatTime(video.duration) : "0:00";
    const status = $("video-status");
    if (status) status.textContent = `Video ready · 0:00 / ${d}`;
  });
  video.addEventListener("timeupdate", () => {
    $("video-current-time").textContent = formatTime(video.currentTime);
    $("video-total-time").textContent = formatTime(video.duration);
    if (!state.videoSeeking) $("video-seekbar").value = Number.isFinite(video.duration) && video.duration > 0 ? String(Math.round(video.currentTime / video.duration * 1000)) : "0";
    const status = $("video-status");
    if (status && Number.isFinite(video.duration) && video.duration > 0) {
      status.textContent = `${formatTime(video.currentTime)} / ${formatTime(video.duration)} · Use video controls to seek`;
    }
  });
  video.addEventListener("play", () => { const status = $("video-status"); if (status) status.dataset.playing = "true"; });
  video.addEventListener("pause", () => { const status = $("video-status"); if (status) status.dataset.playing = "false"; });
  video.addEventListener("ended", () => { if (state.files.length > 1) playIndex(state.index + 1, true); });
  const playbackError = (event) => {
    const media = event.currentTarget;
    if (media.error) $("current-type").textContent = "FORMAT OR CODEC NOT SUPPORTED BY THIS DEVICE";
  };
  audio.addEventListener("error", playbackError); video.addEventListener("error", playbackError);
  window.addEventListener("pagehide", revokeUrls);
  state.shuffleScope = "all";
  setVolumeBoost("audio", 100);
  setVolumeBoost("video", 100);
  updateModes();
<<<<<<< HEAD
  // One shared handler is called by MainActivity's native Back override.
  // Keep Capacitor's event as a fallback for environments without the native bridge.
  let backHandling = false;
  window.handleMerajAndroidBack = async function () {
    if (backHandling) return;
    backHandling = true;
    try {
=======
  // Register exactly one Android Back handler. Duplicate listeners can consume
  // the same press and make the system Back button appear unresponsive.
  try {
    App.addListener("backButton", async () => {
>>>>>>> 9dfd25251da4f3919cd8c783f4dbc42c0528eba2
      const frame = $("video-frame");
      const stage = $("media-stage");
      if (document.fullscreenElement) {
        try { await document.exitFullscreen(); } catch (_) {}
        try { screen.orientation?.unlock?.(); } catch (_) {}
        return;
      }
      if (frame && frame.classList.contains("is-fullscreen")) {
        frame.classList.remove("is-fullscreen");
        try { screen.orientation?.unlock?.(); } catch (_) {}
        positionVideoControls();
        showVideoControls(false);
        return;
      }
      if (stage && !stage.classList.contains("hidden")) {
<<<<<<< HEAD
        video.pause(); audio.pause();
=======
        video.pause();
        audio.pause();
>>>>>>> 9dfd25251da4f3919cd8c783f4dbc42c0528eba2
        stage.classList.add("hidden");
        if (frame) frame.classList.add("hidden");
        document.body.classList.remove("video-playing");
        if (state.videoLocked) setVideoLock(false);
        try { screen.orientation?.unlock?.(); } catch (_) {}
        renderPlaylist();
        return;
      }
      if (!playerScreen.classList.contains("hidden")) {
<<<<<<< HEAD
        // Stay on the library; Android's normal task navigation can exit if needed.
        return;
      }
      try { await App.exitApp(); } catch (_) {}
    } finally {
      setTimeout(() => { backHandling = false; }, 250);
    }
  };
  try {
    App.addListener("backButton", () => window.handleMerajAndroidBack?.());
  } catch (_) { /* Native App plugin unavailable in browser preview. */ }
=======
        // On the library, Back exits the app as expected.
        try { await App.exitApp(); } catch (_) {}
        return;
      }
      try { await App.exitApp(); } catch (_) {}
    });
  } catch (_) { /* Native App plugin is unavailable in browser preview. */ }
>>>>>>> 9dfd25251da4f3919cd8c783f4dbc42c0528eba2

  renderPlaylist();
  // Video-only app: open the local video library and request permission on startup.
  openMode("video");
  updateVideoLibraryTabs();
  scanDeviceLibrary();
})();
