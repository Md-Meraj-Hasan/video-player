/**
 * Meraj Video Player — Native Capacitor Bridge & UI Logic
 * Communicates with parent src/js/app.js via 'meraj-video-native' protocol.
 */

let videos = [];
let currentVideoIndex = -1;
let currentFolder = '__all__';
let isControlsLocked = false;
let unlockButtonTimer = null;
let controlsHideTimer = null;
let currentDisplayMode = 'fit';
let isLandscapeLocked = false;

let reqCounter = 0;
const pendingRequests = new Map();

const $ = (id) => document.getElementById(id);

function formatTime(seconds) {
  if (isNaN(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

// ========================================================
// 1. NATIVE BRIDGE REQUEST DISPATCHER (Exact Parent Match)
// ========================================================
function callNative(action, payload = {}) {
  return new Promise((resolve, reject) => {
    const requestId = 'req_' + (++reqCounter) + '_' + Date.now();
    pendingRequests.set(requestId, { resolve, reject });

    window.parent.postMessage({
      bridge: 'meraj-video-native',
      requestId,
      action,
      payload
    }, '*');

    setTimeout(() => {
      if (pendingRequests.has(requestId)) {
        pendingRequests.delete(requestId);
        reject(new Error('Native request timeout: ' + action));
      }
    }, 12000);
  });
}

// Listen for replies from parent src/js/app.js
window.addEventListener('message', (event) => {
  const msg = event.data;
  if (!msg) return;

  // Handle native result
  if (msg.bridge === 'meraj-video-native-result' && msg.requestId) {
    const pending = pendingRequests.get(msg.requestId);
    if (pending) {
      pendingRequests.delete(msg.requestId);
      if (msg.ok) pending.resolve(msg.result);
      else pending.reject(new Error(msg.error || 'Native bridge call failed'));
    }
    return;
  }

  // Handle hardware Android back button
  if (msg.type === 'meraj-video-native-back') {
    const frame = $('video-frame');
    if (frame && !frame.classList.contains('hidden')) {
      collapseVideo();
    } else {
      returnToAudio();
    }
    return;
  }

  // Handle parent navigating away from video tab
  if (msg.type === 'meraj-video-parent-hide') {
    const video = $('video-element');
    if (video) video.pause();
  }
});

// ========================================================
// 2. AUDIO RETURN & SCAN LOGIC
// ========================================================
function returnToAudio() {
  const video = $('video-element');
  if (video) video.pause();
  // Exact trigger handled by src/js/app.js
  window.parent.postMessage({ type: 'meraj-video-switch-audio' }, '*');
}

async function scanDeviceVideos() {
  const emptyTitle = $('empty-title');
  const emptyDesc = $('empty-description');
  if (emptyTitle) emptyTitle.textContent = "Scanning device for videos…";
  if (emptyDesc) emptyDesc.textContent = "Please wait while local files are loaded.";

  try {
    // Step 1: Request permission
    const perm = await callNative('permission');
    if (perm && perm.granted === false) {
      if (emptyTitle) emptyTitle.textContent = "Permission Needed";
      if (emptyDesc) emptyDesc.textContent = "Please grant video/media permission in app settings.";
      return;
    }

    // Step 2: Native MediaLibraryScanner.scan({ type: 'video' })
    const result = await callNative('scan', { type: 'video' });
    const items = (result && (result.items || result.videos)) || (Array.isArray(result) ? result : []);

    videos = items.map((x) => ({
      id: String(x.id || x.uri),
      uri: x.uri,
      mimeType: x.mimeType || x.type || 'video/*',
      name: (x.name || 'Unknown Video').replace(/\.[^.]+$/, ''),
      title: (x.name || 'Unknown Video').replace(/\.[^.]+$/, ''),
      path: x.relativePath || x.path || 'Device Videos',
      folder: x.relativePath ? x.relativePath.split('/')[0] : 'Device Videos',
      duration: Number(x.duration || 0) > 1000 ? Math.floor(Number(x.duration) / 1000) : Number(x.duration || 0),
      size: Number(x.size || 0),
      thumbnail: null
    }));

    if (videos.length > 0) {
      $('empty-library')?.classList.add('hidden');
      $('video-status')?.classList.add('hidden');
      renderFolders();
      renderPlaylist();
      fetchThumbnails();
    } else {
      if (emptyTitle) emptyTitle.textContent = "No videos found";
      if (emptyDesc) emptyDesc.textContent = "No video files were detected on this device storage.";
    }
  } catch (err) {
    console.error('[Meraj Video] Scan error:', err);
    if (emptyTitle) emptyTitle.textContent = "Scan could not complete";
    if (emptyDesc) emptyDesc.textContent = "Tap ⟳ Rescan to try again.";
  }
}

// Background thumbnail loader using getThumbnail bridge
async function fetchThumbnails() {
  for (let i = 0; i < Math.min(videos.length, 30); i++) {
    const v = videos[i];
    if (!v.thumbnail && v.id) {
      try {
        const thumbResult = await callNative('getThumbnail', { id: v.id, uri: v.uri });
        if (thumbResult?.thumbnail) {
          v.thumbnail = thumbResult.thumbnail;
          const img = document.querySelector(`[data-thumb-index="${i}"]`);
          if (img) img.src = v.thumbnail;
        }
      } catch (_) {}
    }
  }
}

// ========================================================
// 3. PLAYBACK & PREPARE PLAYBACK BRIDGE
// ========================================================
async function playVideoAtIndex(index) {
  if (index < 0 || index >= videos.length) return;
  currentVideoIndex = index;
  const item = videos[index];

  const displayName = item.title || item.name;

  // Videos must be played by the native AndroidX Media3 ExoPlayer Activity.
  // Do not route content:// URIs through the HTML <video> element or copy them to cache.
  try {
    const queue = videos.map((v) => ({
      uri: v.uri,
      name: v.title || v.name || 'Video',
      mimeType: v.mimeType || v.type || 'video/*'
    }));
    const result = await callNative('launchVideo', {
      id: item.id,
      uri: item.uri,
      name: displayName,
      mimeType: item.mimeType || item.type || 'video/*',
      theme: (() => { try { return localStorage.getItem('merajMusicTheme') || 'default'; } catch (_) { return 'default'; } })(),
      queue
    });
    if (!result?.opened) throw new Error('Native Media3 player did not open.');
    renderPlaylist();
  } catch (err) {
    console.error('[Meraj Video] Media3 launch failed:', err);
    const status = $('video-status');
    if (status) {
      status.textContent = 'Could not open this video in Media3 ExoPlayer. Please rescan and try again.';
      status.classList.remove('hidden');
    }
  }
}

function collapseVideo() {
  const video = $('video-element');
  if (video) video.pause();
  $('media-stage')?.classList.add('hidden');
  $('video-frame')?.classList.add('hidden');
}

// ========================================================
// 4. LOCK SYSTEM & OVERLAY CONTROLS
// ========================================================
function lockPlayer() {
  isControlsLocked = true;
  $('video-frame')?.classList.add('is-locked');
  $('video-overlay-controls')?.classList.add('hidden');
  $('video-speed-menu')?.classList.add('hidden');
  $('video-overlay-volume-panel')?.classList.add('hidden');
  showFloatingUnlock();
}

function unlockPlayer() {
  isControlsLocked = false;
  $('video-frame')?.classList.remove('is-locked');
  $('video-floating-unlock')?.classList.add('hidden');
  clearTimeout(unlockButtonTimer);
  showControls();
}

function showFloatingUnlock() {
  const unlockBtn = $('video-floating-unlock');
  if (!unlockBtn) return;
  unlockBtn.classList.remove('hidden');
  clearTimeout(unlockButtonTimer);
  unlockButtonTimer = setTimeout(() => {
    if (isControlsLocked) unlockBtn.classList.add('hidden');
  }, 3500);
}

function showControls() {
  if (isControlsLocked) return;
  $('video-overlay-controls')?.classList.remove('hidden');
  resetControlsTimer();
}

function hideControls() {
  if (isControlsLocked) return;
  $('video-overlay-controls')?.classList.add('hidden');
  $('video-speed-menu')?.classList.add('hidden');
  $('video-overlay-volume-panel')?.classList.add('hidden');
  clearTimeout(controlsHideTimer);
}

function resetControlsTimer() {
  clearTimeout(controlsHideTimer);
  const video = $('video-element');
  if (video && !video.paused) {
    controlsHideTimer = setTimeout(() => hideControls(), 4000);
  }
}

// ========================================================
// 5. PLAYLIST & FOLDERS RENDERING
// ========================================================
function renderPlaylist() {
  const playlistEl = $('playlist');
  const trackCountEl = $('track-count');
  const searchInput = $('video-search');
  if (!playlistEl) return;

  const query = (searchInput?.value || '').toLowerCase().trim();
  const filtered = videos.filter(v => {
    const matchesSearch = (v.title || '').toLowerCase().includes(query);
    const matchesFolder = (currentFolder === '__all__' || v.folder === currentFolder);
    return matchesSearch && matchesFolder;
  });

  if (trackCountEl) trackCountEl.textContent = filtered.length;

  if (filtered.length === 0) {
    playlistEl.innerHTML = `<div class="playlist-empty">No videos found. Tap ⟳ Rescan to refresh.</div>`;
    return;
  }

  playlistEl.innerHTML = filtered.map((v) => {
    const originalIndex = videos.indexOf(v);
    const isActive = originalIndex === currentVideoIndex;
    return `
      <div class="video-item ${isActive ? 'active' : ''}" data-index="${originalIndex}">
        <div class="video-thumb">
          ${v.thumbnail ? `<img src="${v.thumbnail}" class="thumb-img" data-thumb-index="${originalIndex}" alt="">` : '▶'}
        </div>
        <div class="video-meta">
          <strong>${v.title}</strong>
          <small>${formatTime(v.duration)} • ${v.folder}</small>
        </div>
      </div>
    `;
  }).join('');

  playlistEl.querySelectorAll('.video-item').forEach(row => {
    row.addEventListener('click', () => {
      const idx = parseInt(row.getAttribute('data-index'), 10);
      playVideoAtIndex(idx);
    });
  });
}

function renderFolders() {
  const folderStrip = $('video-folder-strip');
  if (!folderStrip) return;
  const folders = new Set();
  videos.forEach(v => { if (v.folder) folders.add(v.folder); });

  folderStrip.innerHTML = `<div class="folder-chip ${currentFolder === '__all__' ? 'active' : ''}" data-folder="__all__">All (${videos.length})</div>` +
    Array.from(folders).map(f => `
      <div class="folder-chip ${currentFolder === f ? 'active' : ''}" data-folder="${f}">${f}</div>
    `).join('');

  folderStrip.querySelectorAll('.folder-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      currentFolder = chip.getAttribute('data-folder');
      folderStrip.querySelectorAll('.folder-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      renderPlaylist();
    });
  });
}

// ========================================================
// 6. INITIALIZATION & EVENT BINDINGS
// ========================================================
function init() {
  const video = $('video-element');
  const frame = $('video-frame');
  const overlay = $('video-overlay-controls');
  const playBtn = $('video-overlay-play');
  const seekbar = $('video-seekbar');
  const curTime = $('video-current-time');
  const totTime = $('video-total-time');

  // Bottom Audio Return (Exact Bridge Match)
  $('bottom-audio-return')?.addEventListener('click', (e) => {
    e.preventDefault();
    returnToAudio();
  });

  // Rescan Buttons
  $('rescan-library-top')?.addEventListener('click', scanDeviceVideos);
  // Tap the palette icon to cycle solid premium themes; selection syncs with audio.
  const videoThemeToggle = $('video-theme-toggle');
  const videoThemeNames = ['default','green','red','silver','graphite','blue','ocean','sunset','gold','ice'];
  const applyVideoTheme = (theme, save=true) => {
    if (!videoThemeNames.includes(theme)) theme = 'default';
    document.documentElement.dataset.videoTheme = theme;
    if (videoThemeToggle) { videoThemeToggle.dataset.theme = theme; videoThemeToggle.setAttribute('aria-label', 'Color theme: '+theme+'; tap to change'); videoThemeToggle.title = 'Theme: '+theme+' · tap to change'; }
    if (save) { try { localStorage.setItem('merajMusicTheme', theme); } catch (_) {} }
  };
  let savedVideoTheme = 'default';
  try { savedVideoTheme = localStorage.getItem('merajMusicTheme') || 'default'; } catch (_) {}
  applyVideoTheme(savedVideoTheme, false);
  videoThemeToggle?.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    const current = document.documentElement.dataset.videoTheme || 'default';
    applyVideoTheme(videoThemeNames[(videoThemeNames.indexOf(current)+1)%videoThemeNames.length]);
  });
  window.addEventListener('storage', (e) => { if (e.key === 'merajMusicTheme' && e.newValue) applyVideoTheme(e.newValue, false); });
  $('bottom-rescan')?.addEventListener('click', scanDeviceVideos);
  $('choose-video')?.addEventListener('click', scanDeviceVideos);

  // Play / Pause
  playBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!video) return;
    if (video.paused) {
      video.play();
      playBtn.textContent = '❚❚';
      resetControlsTimer();
    } else {
      video.pause();
      playBtn.textContent = '▶';
      clearTimeout(controlsHideTimer);
    }
  });

  video?.addEventListener('play', () => {
    if (playBtn) playBtn.textContent = '❚❚';
    resetControlsTimer();
  });

  video?.addEventListener('pause', () => {
    if (playBtn) playBtn.textContent = '▶';
    showControls();
  });

  video?.addEventListener('ended', () => {
    if (currentVideoIndex < videos.length - 1) {
      playVideoAtIndex(currentVideoIndex + 1);
    } else if (playBtn) {
      playBtn.textContent = '▶';
      showControls();
    }
  });

  video?.addEventListener('timeupdate', () => {
    if (!seekbar || seekbar.matches(':active')) return;
    const cur = video.currentTime || 0;
    const dur = video.duration || 0;
    if (curTime) curTime.textContent = formatTime(cur);
    if (dur > 0) {
      if (totTime) totTime.textContent = formatTime(dur);
      seekbar.value = Math.floor((cur / dur) * 1000);
    }
  });

  seekbar?.addEventListener('input', () => {
    const dur = video?.duration || 0;
    if (dur > 0 && curTime) curTime.textContent = formatTime((seekbar.value / 1000) * dur);
  });

  seekbar?.addEventListener('change', () => {
    const dur = video?.duration || 0;
    if (dur > 0 && video) video.currentTime = (seekbar.value / 1000) * dur;
    resetControlsTimer();
  });

  // Transport: Rewind 15s | Previous | Next | Forward 15s
  $('video-overlay-rewind')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (video) video.currentTime = Math.max(0, video.currentTime - 15);
    resetControlsTimer();
  });

  $('video-overlay-forward')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (video) video.currentTime = Math.min(video.duration || 0, video.currentTime + 15);
    resetControlsTimer();
  });

  $('video-overlay-previous')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (currentVideoIndex > 0) playVideoAtIndex(currentVideoIndex - 1);
    else if (video) video.currentTime = 0;
  });

  $('video-overlay-next')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (currentVideoIndex < videos.length - 1) playVideoAtIndex(currentVideoIndex + 1);
  });

  // Display Fit Modes (Fit -> Zoom -> Stretch)
  $('video-overlay-display')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!video) return;
    const label = $('video-display-label');
    if (currentDisplayMode === 'fit') {
      currentDisplayMode = 'zoom';
      video.style.objectFit = 'cover';
      if (label) label.textContent = 'Zoom';
    } else if (currentDisplayMode === 'zoom') {
      currentDisplayMode = 'stretch';
      video.style.objectFit = 'fill';
      if (label) label.textContent = 'Stretch';
    } else {
      currentDisplayMode = 'fit';
      video.style.objectFit = 'contain';
      if (label) label.textContent = 'Fit';
    }
    resetControlsTimer();
  });

  // Volume Slider
  $('video-overlay-volume')?.addEventListener('click', (e) => {
    e.stopPropagation();
    $('video-overlay-volume-panel')?.classList.toggle('hidden');
  });

  $('video-overlay-volume-slider')?.addEventListener('input', (e) => {
    if (!video) return;
    video.volume = e.target.value / 100;
  });

  // Playback Speed
  $('video-overlay-speed')?.addEventListener('click', (e) => {
    e.stopPropagation();
    $('video-speed-menu')?.classList.toggle('hidden');
  });
  $('video-speed-menu')?.querySelectorAll('[data-speed]').forEach((button) => {
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      const speed = Number(button.getAttribute('data-speed'));
      if (!Number.isFinite(speed) || !video) return;
      video.playbackRate = speed;
      const label = $('video-overlay-speed-label');
      if (label) label.textContent = speed === 1 ? '1×' : `${speed}×`;
      $('video-speed-menu')?.classList.add('hidden');
      resetControlsTimer();
    });
  });

  $('video-overlay-lock')?.addEventListener('click', (e) => { e.stopPropagation(); lockPlayer(); });
  $('video-floating-unlock')?.addEventListener('click', (e) => { e.stopPropagation(); unlockPlayer(); });
  $('collapse-video-stage')?.addEventListener('click', (e) => { e.stopPropagation(); collapseVideo(); });
  frame?.addEventListener('click', (e) => {
    if (e.target.closest('button, input, .video-speed-menu, .video-overlay-volume-panel')) return;
    if (isControlsLocked) showFloatingUnlock();
    else if (overlay?.classList.contains('hidden')) showControls();
    else resetControlsTimer();
  });

  $('video-overlay-landscape')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    isLandscapeLocked = !isLandscapeLocked;
    try {
      await callNative('orientation', { orientation: isLandscapeLocked ? 'landscape' : 'portrait' });
    } catch (_) {
      try {
        if (isLandscapeLocked && screen.orientation?.lock) await screen.orientation.lock('landscape');
        else screen.orientation?.unlock?.();
      } catch (_) {}
    }
  });

  $('video-search')?.addEventListener('input', renderPlaylist);
  $('video-tab-all')?.addEventListener('click', () => {
    currentFolder = '__all__';
    $('video-tab-all')?.classList.add('selected');
    $('video-tab-folders')?.classList.remove('selected');
    renderFolders(); renderPlaylist();
  });
  $('video-tab-folders')?.addEventListener('click', () => {
    $('video-tab-folders')?.classList.add('selected');
    $('video-tab-all')?.classList.remove('selected');
    $('video-folder-strip')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
  $('bottom-library')?.addEventListener('click', () => {
    currentFolder = '__all__'; renderFolders(); renderPlaylist();
    $('video-tab-all')?.classList.add('selected');
    $('video-tab-folders')?.classList.remove('selected');
  });
  $('bottom-folders')?.addEventListener('click', () => $('video-tab-folders')?.click());
  $('share-video-app')?.addEventListener('click', () => {
    window.parent.postMessage({ type: 'meraj-video-share-app' }, '*');
  });

  // Avoid the previous duplicate welcome/library screens.
  $('welcome-screen')?.classList.add('hidden');
  $('player-screen')?.classList.remove('hidden');
  scanDeviceVideos();
}

document.addEventListener('DOMContentLoaded', init, { once: true });
