/**
 * Meraj Video Player — Core App Script
 * Offline local playback, full-width glassmorphism controls,
 * strict lock safety system, and Android parent-bridge integration.
 */

// --- State ---
let videos = [];
let currentVideoIndex = -1;
let currentFolder = '__all__';
let isControlsLocked = false;
let unlockButtonTimer = null;
let controlsHideTimer = null;
let currentDisplayMode = 'fit'; // 'fit' (contain) -> 'zoom' (cover) -> 'stretch' (fill)

// --- DOM Elements ---
const videoElement = document.getElementById('video-element');
const videoFrame = document.getElementById('video-frame');
const mediaStage = document.getElementById('media-stage');
const overlayControls = document.getElementById('video-overlay-controls');
const overlayTitle = document.getElementById('video-overlay-title');
const currentName = document.getElementById('current-name');

// Buttons & Transport
const playBtn = document.getElementById('video-overlay-play');
const prevBtn = document.getElementById('video-overlay-previous');
const nextBtn = document.getElementById('video-overlay-next');
const rewindBtn = document.getElementById('video-overlay-rewind');
const forwardBtn = document.getElementById('video-overlay-forward');

// Seekbar & Times
const seekbar = document.getElementById('video-seekbar');
const currentTimeEl = document.getElementById('video-current-time');
const totalTimeEl = document.getElementById('video-total-time');

// Lock & Utility
const lockBtn = document.getElementById('video-overlay-lock');
const floatingUnlockBtn = document.getElementById('video-floating-unlock');
const displayBtn = document.getElementById('video-overlay-display');
const displayLabel = document.getElementById('video-display-label');
const volumeBtn = document.getElementById('video-overlay-volume');
const volumePanel = document.getElementById('video-overlay-volume-panel');
const volumeSlider = document.getElementById('video-overlay-volume-slider');
const landscapeBtn = document.getElementById('video-overlay-landscape');
const collapseBtn = document.getElementById('collapse-video-stage');

// Speed
const speedBtn = document.getElementById('video-overlay-speed');
const speedLabel = document.getElementById('video-overlay-speed-label');
const speedMenu = document.getElementById('video-speed-menu');

// Library & Playlist
const playlistEl = document.getElementById('playlist');
const trackCountEl = document.getElementById('track-count');
const searchInput = document.getElementById('video-search');
const folderStrip = document.getElementById('video-folder-strip');
const emptyLibrary = document.getElementById('empty-library');
const tabAll = document.getElementById('video-tab-all');
const tabFolders = document.getElementById('video-tab-folders');

// Top & Bottom Navigation Actions
const chooseVideoBtn = document.getElementById('choose-video');
const shareAppBtn = document.getElementById('share-video-app');
const rescanBtn = document.getElementById('rescan-library-top');
const bottomRescan = document.getElementById('bottom-rescan');
const bottomLibrary = document.getElementById('bottom-library');
const bottomFolders = document.getElementById('bottom-folders');
const bottomAudioReturn = document.getElementById('bottom-audio-return');

// ========================================================
// FORMAT UTILITIES
// ========================================================
function formatTime(seconds) {
  if (isNaN(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

// ========================================================
// 🔒 LOCK SYSTEM IMPLEMENTATION
// ========================================================
function lockPlayer() {
  isControlsLocked = true;
  videoFrame.classList.add('is-locked');
  overlayControls.classList.add('hidden');
  speedMenu.classList.add('hidden');
  volumePanel.classList.add('hidden');
  
  showFloatingUnlock();
}

function unlockPlayer() {
  isControlsLocked = false;
  videoFrame.classList.remove('is-locked');
  floatingUnlockBtn.classList.add('hidden');
  clearTimeout(unlockButtonTimer);
  
  // Restore overlay controls
  showControls();
}

function showFloatingUnlock() {
  floatingUnlockBtn.classList.remove('hidden');
  clearTimeout(unlockButtonTimer);
  
  // Auto-fade unlock pill after 3.5 seconds
  unlockButtonTimer = setTimeout(() => {
    if (isControlsLocked) {
      floatingUnlockBtn.classList.add('hidden');
    }
  }, 3500);
}

lockBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  lockPlayer();
});

floatingUnlockBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  unlockPlayer();
});

// ========================================================
// OVERLAY SHOW / HIDE & AUTO-HIDE LOGIC
// ========================================================
function showControls() {
  if (isControlsLocked) return;
  overlayControls.classList.remove('hidden');
  resetControlsTimer();
}

function hideControls() {
  if (isControlsLocked) return;
  overlayControls.classList.add('hidden');
  speedMenu.classList.add('hidden');
  volumePanel.classList.add('hidden');
  clearTimeout(controlsHideTimer);
}

function resetControlsTimer() {
  clearTimeout(controlsHideTimer);
  if (!videoElement.paused) {
    controlsHideTimer = setTimeout(() => {
      hideControls();
    }, 4000);
  }
}

// Tap on Video Frame
videoFrame.addEventListener('click', (e) => {
  // If tapped directly on a button or menu, skip
  if (e.target.closest('button') || e.target.closest('.video-speed-menu') || e.target.closest('.video-overlay-volume-panel')) {
    return;
  }
  
  if (isControlsLocked) {
    // When locked, show only the unlock button temporarily
    showFloatingUnlock();
    return;
  }

  if (overlayControls.classList.contains('hidden')) {
    showControls();
  } else {
    hideControls();
  }
});

// Prevent taps inside overlay from instantly closing it
overlayControls.addEventListener('click', () => {
  resetControlsTimer();
});

// ========================================================
// VIDEO PLAYBACK & CONTROLS
// ========================================================
function playVideoAtIndex(index) {
  if (index < 0 || index >= videos.length) return;
  
  currentVideoIndex = index;
  const item = videos[index];

  mediaStage.classList.remove('hidden');
  videoFrame.classList.remove('hidden');
  videoElement.classList.remove('hidden');

  overlayTitle.textContent = item.name || item.title || 'Playing video';
  currentName.textContent = item.name || item.title || 'Playing video';

  videoElement.src = item.url || item.uri || item.path;
  videoElement.load();
  videoElement.play().catch(() => {});
  
  playBtn.textContent = '❚❚';
  showControls();
  renderPlaylist();
}

playBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (videoElement.paused) {
    videoElement.play();
    playBtn.textContent = '❚❚';
    resetControlsTimer();
  } else {
    videoElement.pause();
    playBtn.textContent = '▶';
    clearTimeout(controlsHideTimer);
  }
});

videoElement.addEventListener('play', () => {
  playBtn.textContent = '❚❚';
  resetControlsTimer();
});

videoElement.addEventListener('pause', () => {
  playBtn.textContent = '▶';
  showControls();
});

videoElement.addEventListener('ended', () => {
  if (currentVideoIndex < videos.length - 1) {
    playVideoAtIndex(currentVideoIndex + 1);
  } else {
    playBtn.textContent = '▶';
    showControls();
  }
});

// Seek updates
videoElement.addEventListener('timeupdate', () => {
  if (!seekbar.matches(':active')) {
    const current = videoElement.currentTime || 0;
    const duration = videoElement.duration || 0;
    currentTimeEl.textContent = formatTime(current);
    if (duration > 0) {
      totalTimeEl.textContent = formatTime(duration);
      seekbar.value = Math.floor((current / duration) * 1000);
    }
  }
});

seekbar.addEventListener('input', () => {
  const duration = videoElement.duration || 0;
  if (duration > 0) {
    const seekTo = (seekbar.value / 1000) * duration;
    currentTimeEl.textContent = formatTime(seekTo);
  }
});

seekbar.addEventListener('change', () => {
  const duration = videoElement.duration || 0;
  if (duration > 0) {
    videoElement.currentTime = (seekbar.value / 1000) * duration;
  }
  resetControlsTimer();
});

// 15-second rew/fwd
rewindBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  videoElement.currentTime = Math.max(0, videoElement.currentTime - 15);
  resetControlsTimer();
});

forwardBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  videoElement.currentTime = Math.min(videoElement.duration || 0, videoElement.currentTime + 15);
  resetControlsTimer();
});

prevBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (currentVideoIndex > 0) {
    playVideoAtIndex(currentVideoIndex - 1);
  } else {
    videoElement.currentTime = 0;
  }
});

nextBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (currentVideoIndex < videos.length - 1) {
    playVideoAtIndex(currentVideoIndex + 1);
  }
});

// Display Modes (Fit -> Zoom -> Stretch)
displayBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (currentDisplayMode === 'fit') {
    currentDisplayMode = 'zoom';
    videoElement.style.objectFit = 'cover';
    displayLabel.textContent = 'Zoom';
  } else if (currentDisplayMode === 'zoom') {
    currentDisplayMode = 'stretch';
    videoElement.style.objectFit = 'fill';
    displayLabel.textContent = 'Stretch';
  } else {
    currentDisplayMode = 'fit';
    videoElement.style.objectFit = 'contain';
    displayLabel.textContent = 'Fit';
  }
  resetControlsTimer();
});

// Volume Controls
volumeBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  volumePanel.classList.toggle('hidden');
});

volumeSlider.addEventListener('input', () => {
  videoElement.volume = volumeSlider.value / 100;
  videoElement.muted = (volumeSlider.value == 0);
  volumeBtn.querySelector('.util-icon').textContent = volumeSlider.value == 0 ? '🔇' : '🔊';
});

// Playback Speed
speedBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  speedMenu.classList.toggle('hidden');
});

speedMenu.addEventListener('click', (e) => {
  e.stopPropagation();
  const speed = e.target.getAttribute('data-speed');
  if (speed) {
    const rate = parseFloat(speed);
    videoElement.playbackRate = rate;
    speedLabel.textContent = `${speed}×`;
    speedMenu.querySelectorAll('button').forEach(b => b.classList.remove('selected'));
    e.target.classList.add('selected');
    speedMenu.classList.add('hidden');
    resetControlsTimer();
  }
});

// Rotate / Landscape Bridge
landscapeBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  } else if (videoFrame.requestFullscreen) {
    videoFrame.requestFullscreen().catch(() => {});
  }
  
  // Post message to Capacitor parent bridge if present
  window.parent?.postMessage({ type: 'meraj:toggleOrientation' }, '*');
  resetControlsTimer();
});

// Collapse Chevron
collapseBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  videoElement.pause();
  mediaStage.classList.add('hidden');
  videoFrame.classList.add('hidden');
});

// ========================================================
// PLAYLIST & LIBRARY LOGIC
// ========================================================
function renderPlaylist() {
  const query = searchInput.value.toLowerCase().trim();
  const filtered = videos.filter(v => {
    const matchesSearch = (v.name || v.title || '').toLowerCase().includes(query);
    const matchesFolder = (currentFolder === '__all__' || v.folder === currentFolder);
    return matchesSearch && matchesFolder;
  });

  trackCountEl.textContent = filtered.length;

  if (filtered.length === 0) {
    playlistEl.innerHTML = `<div class="playlist-empty">No videos found.</div>`;
    return;
  }

  playlistEl.innerHTML = filtered.map((v, i) => {
    const originalIndex = videos.indexOf(v);
    const isActive = originalIndex === currentVideoIndex;
    return `
      <div class="video-item ${isActive ? 'active' : ''}" data-index="${originalIndex}">
        <div class="video-thumb">
          ${v.thumbnail ? `<img src="${v.thumbnail}" alt="">` : '▶'}
        </div>
        <div class="video-meta">
          <strong>${v.name || v.title}</strong>
          <small>${formatTime(v.duration || 0)} • ${v.folder || 'Videos'}</small>
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
  const folders = new Set();
  videos.forEach(v => { if (v.folder) folders.add(v.folder); });

  folderStrip.innerHTML = `<div class="folder-chip ${currentFolder === '__all__' ? 'active' : ''}" data-folder="__all__">All (${videos.length})</div>` +
    Array.from(folders).map(f => `
      <div class="folder-chip ${currentFolder === f ? 'active' : ''}" data-folder="${f}">
        ${f}
      </div>
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

// Search input
searchInput.addEventListener('input', renderPlaylist);

// Tabs
tabAll.addEventListener('click', () => {
  tabAll.classList.add('selected');
  tabFolders.classList.remove('selected');
  currentFolder = '__all__';
  renderFolders();
  renderPlaylist();
});

tabFolders.addEventListener('click', () => {
  tabFolders.classList.add('selected');
  tabAll.classList.remove('selected');
  folderStrip.scrollIntoView({ behavior: 'smooth' });
});

// ========================================================
// SCAN & PARENT BRIDGE INTEGRATION
// ========================================================
function triggerScan() {
  window.parent?.postMessage({ type: 'meraj:scanVideos' }, '*');
}

rescanBtn.addEventListener('click', triggerScan);
bottomRescan.addEventListener('click', triggerScan);
chooseVideoBtn?.addEventListener('click', triggerScan);

shareAppBtn.addEventListener('click', () => {
  if (currentVideoIndex >= 0 && videos[currentVideoIndex]) {
    const video = videos[currentVideoIndex];
    window.parent?.postMessage({ type: 'meraj:shareMedia', media: video }, '*');
  }
});

bottomAudioReturn.addEventListener('click', () => {
  window.parent?.postMessage({ type: 'meraj:navigateTo', page: 'home' }, '*');
});

// Receive scanned videos from Capacitor Host
window.addEventListener('message', (event) => {
  const data = event.data;
  if (!data) return;

  if (data.type === 'meraj:scannedVideos' && Array.isArray(data.videos)) {
    videos = data.videos;
    if (videos.length > 0) {
      emptyLibrary.classList.add('hidden');
    }
    renderFolders();
    renderPlaylist();
  }
});

// Auto-request video list on load
window.addEventListener('DOMContentLoaded', () => {
  window.parent?.postMessage({ type: 'meraj:requestVideoList' }, '*');
});
