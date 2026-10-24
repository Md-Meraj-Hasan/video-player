/**
 * Meraj Video Player — Resilient Offline Application Logic
 */

let videos = [];
let currentVideoIndex = -1;
let currentFolder = '__all__';
let isControlsLocked = false;
let unlockButtonTimer = null;
let controlsHideTimer = null;
let currentDisplayMode = 'fit';

const $ = (id) => document.getElementById(id);

function formatTime(seconds) {
  if (isNaN(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

// ========================================================
// 1. SAFE RETURN TO AUDIO PLAYER
// ========================================================
function returnToAudio() {
  try {
    if (window.parent && window.parent !== window) {
      const parentDoc = window.parent.document;
      const homeBtn = parentDoc.querySelector('.nav[data-page="home"]')
                   || parentDoc.querySelector('[data-page="home"]')
                   || parentDoc.querySelector('.brand[data-page="home"]');
      if (homeBtn) {
        homeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        homeBtn.click();
        return;
      }
    }
  } catch (err) {
    console.warn('[Meraj Video] Direct parent navigation blocked, using postMessage', err);
  }

  // Cross-frame fallback messages
  const navMsgs = [
    { type: 'meraj:navigateTo', page: 'home' },
    { type: 'NAVIGATE', page: 'home' },
    { action: 'navigate', page: 'home' },
    { type: 'meraj:audioReturn' }
  ];
  navMsgs.forEach(msg => {
    try { window.parent.postMessage(msg, '*'); } catch (e) {}
  });
}

// ========================================================
// 2. VIDEO SCANNER TRIGGER & BRIDGE
// ========================================================
function triggerScan() {
  const emptyTitle = $('empty-title');
  const emptyDesc = $('empty-description');
  if (emptyTitle) emptyTitle.textContent = "Scanning device for videos…";
  if (emptyDesc) emptyDesc.textContent = "Please wait while local files are loaded.";

  // Direct parent call
  try {
    if (window.parent && window.parent !== window) {
      if (typeof window.parent.scanVideos === 'function') window.parent.scanVideos();
      if (typeof window.parent.triggerVideoScan === 'function') window.parent.triggerVideoScan();
    }
  } catch (e) {}

  // PostMessage to parent Capacitor bridge
  const scanEvents = [
    { type: 'meraj:scanVideos' },
    { type: 'meraj:scan' },
    { type: 'SCAN_VIDEOS' },
    { action: 'scanVideos' },
    { action: 'scan' },
    { type: 'requestVideoList' },
    { type: 'meraj:requestVideoList' }
  ];
  scanEvents.forEach(evt => {
    try { window.parent.postMessage(evt, '*'); } catch (e) {}
  });
}

function handleIncomingVideos(list) {
  if (!Array.isArray(list) || list.length === 0) return;
  videos = list;
  const empty = $('empty-library');
  if (empty) empty.classList.add('hidden');
  renderFolders();
  renderPlaylist();
}

window.addEventListener('message', (event) => {
  const data = event.data;
  if (!data) return;

  let incoming = null;
  if (Array.isArray(data)) incoming = data;
  else if (Array.isArray(data.videos)) incoming = data.videos;
  else if (Array.isArray(data.videoList)) incoming = data.videoList;
  else if (Array.isArray(data.items)) incoming = data.items;
  else if (Array.isArray(data.payload)) incoming = data.payload;
  else if (Array.isArray(data.data)) incoming = data.data;

  if (incoming) {
    handleIncomingVideos(incoming);
  }
});

// ========================================================
// 3. LOCK SYSTEM IMPLEMENTATION
// ========================================================
function lockPlayer() {
  isControlsLocked = true;
  const frame = $('video-frame');
  const overlay = $('video-overlay-controls');
  const speedMenu = $('video-speed-menu');
  const volPanel = $('video-overlay-volume-panel');

  if (frame) frame.classList.add('is-locked');
  if (overlay) overlay.classList.add('hidden');
  if (speedMenu) speedMenu.classList.add('hidden');
  if (volPanel) volPanel.classList.add('hidden');

  showFloatingUnlock();
}

function unlockPlayer() {
  isControlsLocked = false;
  const frame = $('video-frame');
  const unlockBtn = $('video-floating-unlock');

  if (frame) frame.classList.remove('is-locked');
  if (unlockBtn) unlockBtn.classList.add('hidden');
  clearTimeout(unlockButtonTimer);
  showControls();
}

function showFloatingUnlock() {
  const unlockBtn = $('video-floating-unlock');
  if (!unlockBtn) return;
  unlockBtn.classList.remove('hidden');
  clearTimeout(unlockButtonTimer);
  unlockButtonTimer = setTimeout(() => {
    if (isControlsLocked) {
      unlockBtn.classList.add('hidden');
    }
  }, 3500);
}

// ========================================================
// 4. OVERLAY SHOW / HIDE TIMERS
// ========================================================
function showControls() {
  if (isControlsLocked) return;
  const overlay = $('video-overlay-controls');
  if (overlay) overlay.classList.remove('hidden');
  resetControlsTimer();
}

function hideControls() {
  if (isControlsLocked) return;
  const overlay = $('video-overlay-controls');
  const speedMenu = $('video-speed-menu');
  const volPanel = $('video-overlay-volume-panel');
  if (overlay) overlay.classList.add('hidden');
  if (speedMenu) speedMenu.classList.add('hidden');
  if (volPanel) volPanel.classList.add('hidden');
  clearTimeout(controlsHideTimer);
}

function resetControlsTimer() {
  clearTimeout(controlsHideTimer);
  const video = $('video-element');
  if (video && !video.paused) {
    controlsHideTimer = setTimeout(() => {
      hideControls();
    }, 4000);
  }
}

// ========================================================
// 5. PLAYBACK ACTIONS & EVENTS
// ========================================================
function playVideoAtIndex(index) {
  if (index < 0 || index >= videos.length) return;
  currentVideoIndex = index;
  const item = videos[index];

  const stage = $('media-stage');
  const frame = $('video-frame');
  const video = $('video-element');
  const overlayTitle = $('video-overlay-title');
  const curName = $('current-name');
  const playBtn = $('video-overlay-play');

  if (stage) stage.classList.remove('hidden');
  if (frame) frame.classList.remove('hidden');
  if (video) video.classList.remove('hidden');

  const title = item.name || item.title || 'Playing video';
  if (overlayTitle) overlayTitle.textContent = title;
  if (curName) curName.textContent = title;

  // Signal Native Media3 Session
  try {
    window.parent.postMessage({ type: 'meraj:playVideo', video: item, index: index }, '*');
    window.parent.postMessage({ action: 'playVideo', video: item, index: index }, '*');
  } catch (e) {}

  const src = item.url || item.uri || item.path || item.webPath;
  if (src && video) {
    video.src = src;
    video.load();
    video.play().catch(() => {});
  }

  if (playBtn) playBtn.textContent = '❚❚';
  showControls();
  renderPlaylist();
}

// ========================================================
// 6. PLAYLIST & FOLDERS RENDERING
// ========================================================
function renderPlaylist() {
  const playlistEl = $('playlist');
  const trackCountEl = $('track-count');
  const searchInput = $('video-search');
  if (!playlistEl) return;

  const query = (searchInput?.value || '').toLowerCase().trim();
  const filtered = videos.filter(v => {
    const matchesSearch = (v.name || v.title || '').toLowerCase().includes(query);
    const matchesFolder = (currentFolder === '__all__' || v.folder === currentFolder);
    return matchesSearch && matchesFolder;
  });

  if (trackCountEl) trackCountEl.textContent = filtered.length;

  if (filtered.length === 0) {
    playlistEl.innerHTML = `<div class="playlist-empty">No videos found. Tap rescan to refresh.</div>`;
    return;
  }

  playlistEl.innerHTML = filtered.map((v) => {
    const originalIndex = videos.indexOf(v);
    const isActive = originalIndex === currentVideoIndex;
    return `
      <div class="video-item ${isActive ? 'active' : ''}" data-index="${originalIndex}">
        <div class="video-thumb">
          ${v.thumbnail ? `<img src="${v.thumbnail}" alt="">` : '▶'}
        </div>
        <div class="video-meta">
          <strong>${v.name || v.title}</strong>
          <small>${formatTime(v.duration || 0)} • ${v.folder || 'Device Videos'}</small>
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
// 7. INITIALIZE SAFE LISTENERS (ATTACH WHEN DOM IS READY)
// ========================================================
function init() {
  const video = $('video-element');
  const frame = $('video-frame');
  const overlay = $('video-overlay-controls');
  const playBtn = $('video-overlay-play');
  const seekbar = $('video-seekbar');
  const curTime = $('video-current-time');
  const totTime = $('video-total-time');

  // Audio return button
  $('bottom-audio-return')?.addEventListener('click', (e) => {
    e.preventDefault();
    returnToAudio();
  });

  // Rescan buttons
  $('rescan-library-top')?.addEventListener('click', triggerScan);
  $('bottom-rescan')?.addEventListener('click', triggerScan);
  $('choose-video')?.addEventListener('click', triggerScan);

  // File picker fallback
  const filePicker = $('video-file-picker');
  filePicker?.addEventListener('change', (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      const picked = files.map(f => ({
        name: f.name,
        title: f.name.replace(/\.[^/.]+$/, ''),
        url: URL.createObjectURL(f),
        duration: 0,
        folder: 'Picked Files'
      }));
      handleIncomingVideos(picked);
      playVideoAtIndex(0);
    }
  });

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

  // 15s Rewind / Forward
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

  // Display Fit Modes
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

  // Volume
  $('video-overlay-volume')?.addEventListener('click', (e) => {
    e.stopPropagation();
    $('video-overlay-volume-panel')?.classList.toggle('hidden');
  });

  $('video-overlay-volume-slider')?.addEventListener('input', (e) => {
    if (!video) return;
    video.volume = e.target.value / 100;
  });

  // Speed
  $('video-overlay-speed')?.addEventListener('click', (e) => {
    e.stopPropagation();
    $('video-speed-menu')?.classList.toggle('hidden');
  });

  $('video-speed-menu')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const speed = e.target.getAttribute('data-speed');
    if (speed && video) {
      video.playbackRate = parseFloat(speed);
      const label = $('video-overlay-speed-label');
      if (label) label.textContent = `${speed}×`;
      $('video-speed-menu')?.classList.add('hidden');
      resetControlsTimer();
    }
  });

  // Lock & Unlock
  $('video-overlay-lock')?.addEventListener('click', (e) => {
    e.stopPropagation();
    lockPlayer();
  });

  $('video-floating-unlock')?.addEventListener('click', (e) => {
    e.stopPropagation();
    unlockPlayer();
  });

  frame?.addEventListener('click', (e) => {
    if (e.target.closest('button') || e.target.closest('.video-speed-menu') || e.target.closest('.video-overlay-volume-panel')) {
      return;
    }
    if (isControlsLocked) {
      showFloatingUnlock();
      return;
    }
    if (overlay?.classList.contains('hidden')) showControls();
    else hideControls();
  });

  overlay?.addEventListener('click', () => resetControlsTimer());

  // Landscape
  $('video-overlay-landscape')?.addEventListener('click', (e) => {
    e.stopPropagation();
    try {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      else if (frame?.requestFullscreen) frame.requestFullscreen().catch(() => {});
    } catch (err) {}
    window.parent.postMessage({ type: 'meraj:toggleOrientation' }, '*');
    resetControlsTimer();
  });

  // Collapse Stage
  $('collapse-video-stage')?.addEventListener('click', (e) => {
    e.stopPropagation();
    video?.pause();
    $('media-stage')?.classList.add('hidden');
    $('video-frame')?.classList.add('hidden');
  });

  // Tabs & Search
  $('video-search')?.addEventListener('input', renderPlaylist);

  $('video-tab-all')?.addEventListener('click', () => {
    $('video-tab-all')?.classList.add('selected');
    $('video-tab-folders')?.classList.remove('selected');
    currentFolder = '__all__';
    renderFolders();
    renderPlaylist();
  });

  $('video-tab-folders')?.addEventListener('click', () => {
    $('video-tab-folders')?.classList.add('selected');
    $('video-tab-all')?.classList.remove('selected');
    $('video-folder-strip')?.scrollIntoView({ behavior: 'smooth' });
  });

  $('bottom-library')?.addEventListener('click', () => {
    $('video-tab-all')?.click();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  $('bottom-folders')?.addEventListener('click', () => {
    $('video-tab-folders')?.click();
  });

  $('share-video-app')?.addEventListener('click', () => {
    if (currentVideoIndex >= 0 && videos[currentVideoIndex]) {
      window.parent.postMessage({ type: 'meraj:shareMedia', media: videos[currentVideoIndex] }, '*');
    }
  });

  // Auto request library videos
  try {
    window.parent.postMessage({ type: 'meraj:requestVideoList' }, '*');
  } catch (e) {}
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
