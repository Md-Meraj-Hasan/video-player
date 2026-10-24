(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  let nativeRequestCounter = 0;
  const nativePending = new Map();
  
  function callParentNative(action, payload = {}) {
    return new Promise((resolve, reject) => {
      const requestId = `video-${Date.now()}-${++nativeRequestCounter}`;
      const timeout = setTimeout(() => { nativePending.delete(requestId); reject(new Error(`Native ${action} request timed out`)); }, 15000);
      nativePending.set(requestId, { resolve, reject, timeout });
      window.parent.postMessage({ bridge: 'meraj-video-native', requestId, action, payload }, '*');
    });
  }

  window.addEventListener('message', async event => {
    const message = event.data;
    if (!message) return;
    if (message.bridge === 'meraj-video-native-result' && nativePending.has(message.requestId)) {
      const pending = nativePending.get(message.requestId); nativePending.delete(message.requestId); clearTimeout(pending.timeout);
      if (message.ok) pending.resolve(message.result); else pending.reject(new Error(message.error || 'Native operation failed'));
    } else if (message.type === 'meraj-video-native-back') {
      window.handleMerajAndroidBack?.();
    } else if (message.type === 'meraj-video-parent-hide') {
      try { video.pause(); audio.pause(); } catch (_) {}
      try { await callParentNative('orientationLock', { orientation: 'portrait' }); } catch (_) {}
      try { screen.orientation?.unlock?.(); } catch (_) {}
      state.videoOrientationLocked = false;
      if (state.controlsTimer) { clearTimeout(state.controlsTimer); state.controlsTimer = null; }
      $('video-overlay-controls')?.classList.add('hidden');
    }
  });

  const VideoPermissionBridge = { requestIfNeeded: () => callParentNative('permission') };
  const VideoScannerBridge = {
    scan: payload => callParentNative('scan', payload),
    launchVideo: payload => callParentNative('launchVideo', payload),
    getThumbnail: payload => callParentNative('getThumbnail', payload),
    shareMedia: payload => callParentNative('shareMedia', payload)
  };

  const welcome = $("welcome-screen"), playerScreen = $("player-screen");
  const audio = $("audio-element"), video = $("video-element");
  const FAVORITES_KEY = "meraj-video-player-favorites-v1";
  
  const state = {
    mode: "video", files: [], index: 0, objectUrls: [], allAudioFiles: [],
    favorites: loadFavorites(), favoritesOnly: false, shuffle: false,
    repeat: "off", speed: 1, lastPlayed: null, videoLocked: false, videoOrientationLocked: false, videoFit: "contain", lastVideoTap: 0, videoLibraryView: "videos", videoSearch: "", videoSelectedFolder: "", videoSeeking: false, thumbnailCache: new Map(), thumbnailObserver: null, controlsTimer: null, lastTouchAt: 0,
    audioBoost: 1, videoBoost: 1, audioGainContext: null, videoGainContext: null,
    audioGainNode: null, videoGainNode: null, audioSourceNode: null, videoSourceNode: null
  };

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
  
  const mediaPlaybackUrl = (uri) => {
    if (typeof uri !== "string") return uri;
    if (uri.startsWith("content://")) return uri;
    return window.parent?.Capacitor?.convertFileSrc ? window.parent.Capacitor.convertFileSrc(uri) : uri;
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

  async function scanDeviceLibrary() {
    const permission = VideoPermissionBridge;
    const scanner = VideoScannerBridge;
    if (!permission || !scanner) return;
    try {
      const permissionResult = await permission.requestIfNeeded();
      if (!permissionResult?.granted) return;
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
      } else {
        revokeUrls();
        state.files = normalized;
        state.index = 0;
        state.videoSelectedFolder = "";
      }
      renderPlaylist();
      if (normalized.length) {
        $("empty-library").classList.add("hidden");
      }
    } catch (error) {
      console.error("Media scan failed", error);
    }
  }

  function currentAudioList() {
    let list = state.allAudioFiles.slice();
    const folder = $("folder-filter")?.value || "__all__";
    if (folder !== "__all__") list = list.filter(f => getFolder(f) === folder);
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

  function setVideoLock(locked) {
    state.videoLocked = Boolean(locked);
    const lockButton = $("video-overlay-lock");
    if (lockButton) {
      lockButton.textContent = state.videoLocked ? "🔓" : "🔒";
      lockButton.setAttribute("aria-label", state.videoLocked ? "Unlock controls" : "Lock controls");
    }
    const overlayControls = $("video-overlay-controls");
    if (overlayControls) {
      overlayControls.classList.toggle("controls-locked", state.videoLocked);
    }
    video.controls = false;
    if (state.videoLocked && state.controlsTimer) {
      clearTimeout(state.controlsTimer);
      state.controlsTimer = null;
    }
  }

  function renderPlaylist() {
    const list = $("playlist");
    let shown = state.mode === "audio" ? currentAudioList() : state.files;
    if (state.mode === "video") {
      const q = state.videoSearch.trim().toLocaleLowerCase();
      if (q) shown = shown.filter(file => `${file.name || ""} ${getFolder(file)}`.toLocaleLowerCase().includes(q));
      if (state.videoSelectedFolder) shown = shown.filter(file => getFolder(file) === state.videoSelectedFolder);
    }
    $("track-count").textContent = String(shown.length);
    list.replaceChildren();
    if (!shown.length) {
      const empty = document.createElement("div");
      empty.className = "playlist-empty";
      empty.textContent = "No videos found. Tap Rescan to check your device.";
      list.appendChild(empty);
      return;
    }
    shown.forEach((file, i) => {
      const item = document.createElement("div");
      item.className = `playlist-item ${state.mode === "video" ? "video-library-card" : ""}`;
      item.innerHTML = `<div class="playlist-meta"><strong>${file.name}</strong><small>${formatBytes(file.size || 0)}</small></div>`;
      item.addEventListener("click", () => {
        state.index = i;
        if (state.mode === "video") {
          VideoScannerBridge.launchVideo({ uri: file.uri, name: file.name, size: file.size, queue: shown });
        }
      });
      list.appendChild(item);
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("choose-video")?.addEventListener("click", () => { openMode("video"); scanDeviceLibrary(); });
    $("rescan-library-top")?.addEventListener("click", () => scanDeviceLibrary());
    $("bottom-rescan")?.addEventListener("click", () => scanDeviceLibrary());
    $("video-overlay-lock")?.addEventListener("click", (e) => {
      e.stopPropagation();
      setVideoLock(!state.videoLocked);
    });
  });
})();
