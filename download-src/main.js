import "./style.css";
// Native downloader calls are proxied through the parent Nice Multimedia Capacitor bridge.
const Capacitor = { isNativePlatform: () => true };

import { Innertube, Platform } from "youtubei.js/web";

Platform.shim.eval = async (data) => new Function(data.output)();
const youtubeClients = new Map();

let nativeRequestSequence = 0;
const nativePending = new Map();
const nativeListeners = new Map();
window.addEventListener("message", event => {
  if (event.source !== window.parent) return;
  const message = event.data;
  if ((message?.bridge === "nice-downloader-native-result" || message?.type === "nice-downloader-native-result") && message.requestId) {
    const pending = nativePending.get(message.requestId);
    if (!pending) return;
    nativePending.delete(message.requestId);
    if (message.ok) pending.resolve(message.result);
    else pending.reject(new Error(message.error || "Native downloader request failed"));
  } else if (message?.type === "nice-downloader-native-event") {
    for (const callback of nativeListeners.get(message.eventName) || []) {
      try { callback(message.data || {}); } catch (error) { console.error(error); }
    }
  }
});
function callNativeDownloader(action, payload = {}) {
  return new Promise((resolve, reject) => {
    const requestId = "nice-downloader-" + (++nativeRequestSequence);
    const timeoutMs = action === "downloadStream" ? 30 * 60 * 1000
      : action === "httpRequest" ? 90000
      : action === "requestStoragePermission" ? 20000
      : action === "getStorageStatus" ? 8000
      : 15000;
    const timer = setTimeout(() => {
      nativePending.delete(requestId);
      reject(new Error(action === "getStorageStatus"
        ? "Storage check timed out. You can still try downloading; Android will manage the save location."
        : "Android downloader did not respond to " + action + ". Please reopen the Download section and try again."));
    }, timeoutMs);
    nativePending.set(requestId, {
      resolve: value => { clearTimeout(timer); resolve(value); },
      reject: error => { clearTimeout(timer); reject(error); }
    });
    window.parent.postMessage({ bridge: "nice-downloader-native", requestId, action, payload }, "*");
  });
}
const YtDlp = {
  httpRequest: payload => callNativeDownloader("httpRequest", payload),
  downloadStream: payload => callNativeDownloader("downloadStream", payload),
  getStorageStatus: payload => callNativeDownloader("getStorageStatus", payload),
  requestStoragePermission: payload => callNativeDownloader("requestStoragePermission", payload),
  openAppSettings: payload => callNativeDownloader("openAppSettings", payload),
  startBackgroundPlaylist: payload => callNativeDownloader("startBackgroundPlaylist", payload),
  updateBackgroundPlaylist: payload => callNativeDownloader("updateBackgroundPlaylist", payload),
  stopBackgroundPlaylist: payload => callNativeDownloader("stopBackgroundPlaylist", payload),
  getPlaylistCancelState: payload => callNativeDownloader("getPlaylistCancelState", payload),
  cancelDownload: payload => callNativeDownloader("cancelDownload", payload),
  listDownloadedVideos: payload => callNativeDownloader("listDownloadedVideos", payload),
  addListener: async (eventName, callback) => {
    const listeners = nativeListeners.get(eventName) || new Set();
    listeners.add(callback);
    nativeListeners.set(eventName, listeners);
    return { remove: async () => listeners.delete(callback) };
  }
};

async function youtubeNativeFetch(input, init = {}) {
  if (!Capacitor.isNativePlatform()) return window.fetch(input, init);
  const request = input instanceof Request ? input : null;
  const url = request ? request.url : String(input);
  const method = String(init.method || request?.method || "GET").toUpperCase();
  const sourceHeaders = new Headers(init.headers || request?.headers || {});
  const headers = {};
  sourceHeaders.forEach((value, key) => { headers[key] = value; });
  let body = init.body;
  if (body == null && request && method !== "GET" && method !== "HEAD") {
    try { body = await request.clone().text(); } catch { body = ""; }
  }
  if (body != null && typeof body !== "string") {
    if (body instanceof URLSearchParams) body = body.toString();
    else if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
      body = new TextDecoder().decode(body instanceof ArrayBuffer ? new Uint8Array(body) : body);
    } else body = String(body);
  }
  const requestOptions = {
    url, method, headers,
    ...(body != null && method !== "GET" && method !== "HEAD" ? { body } : {})
  };

  // Android DNS can briefly fail while resolving YouTube hosts (especially
  // on mobile networks). Retry only DNS-resolution failures; do not delay
  // normal HTTP errors or other request failures.
  let result = null;
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      result = await YtDlp.httpRequest(requestOptions);
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      const message = String(error?.message || error || "");
      const isDnsFailure = /UnknownHostException|Unable to resolve host|No address associated with hostname/i.test(message);
      if (!isDnsFailure || attempt === 2) throw error;
      await new Promise(resolve => setTimeout(resolve, attempt === 0 ? 400 : 1000));
    }
  }
  if (lastError || !result) throw lastError || new Error("YouTube network request failed.");
  return new Response(result.body || "", {
    status: Number(result.status) || 200,
    headers: result.headers || {}
  });
}

async function getYouTubeClient(clientType) {
  if (!youtubeClients.has(clientType)) {
    youtubeClients.set(clientType, Innertube.create({
      client_type: clientType,
      retrieve_player: true,
      enable_session_cache: false,
      fetch: youtubeNativeFetch
    }));
  }
  return youtubeClients.get(clientType);
}

// YouTube.js otherwise uses WebView fetch directly. Native HTTPS avoids WebView
// fetch failures on Android and reuses the app's allow-listed Kotlin network layer.
Platform.shim.fetch = youtubeNativeFetch;
const app = document.querySelector("#app");

const icon = (name) => {
  const paths = {
    home:'<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    download:'<path d="M12 3v12m-5-5 5 5 5-5M4 19v2h16v-2"/>',
    cut:'<path d="M6 6l12 12M18 6 6 18"/><circle cx="6" cy="6" r="2"/><circle cx="18" cy="6" r="2"/>',
    link:'<path d="M10 13a5 5 0 0 0 7.1 0l3-3A5 5 0 0 0 13 2.9l-1.7 1.7M14 11a5 5 0 0 0-7.1 0l-3 3A5 5 0 0 0 11 21.1l1.7-1.7"/>',
    video:'<rect x="3" y="5" width="14" height="14" rx="2"/><path d="m17 10 4-3v10l-4-3z"/>',
    music:'<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
    playlist:'<path d="M4 6h16M4 12h10M4 18h7"/><path d="m17 15 4 3-4 3z"/>',
    speed:'<path d="M3 17a9 9 0 1 1 18 0"/><path d="m12 13 4-4M6 17h12"/>',
    shield:'<path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11z"/><path d="m9 12 2 2 4-4"/>',
    check:'<path d="m5 12 4 4L19 6"/>',
    folder:'<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    settings:'<circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.6a8 8 0 0 1-1.5.9l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.5-.9l-1.7.6-1.4-2.4 1.4-1.1a7 7 0 0 1 0-1.8l-1.4-1.1 1.4-2.4 1.7.6a8 8 0 0 1 1.5-.9l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.5.9l1.7-.6 1.4 2.4-1.4 1.1a7 7 0 0 1 0 1.7z"/>',
  };
  return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'+(paths[name]||paths.download)+'</svg>';
};

app.innerHTML = `
<div class="app-shell">
  <header class="topbar">
    <div class="topbar-brand-row">
      <div class="brand"><div class="brand-mark"><span></span></div><div class="brand-copy"><b>Nice Downloader</b><small>VIDEO DOWNLOADER</small></div></div>
    </div>
    <nav class="top-menu" aria-label="Main menu">
      <button class="menu-item active" data-tab="home"><span>${icon("download")}</span><b>Download</b></button>
      <button class="menu-item" data-tab="downloads"><span>${icon("video")}</span><b>Downloads</b></button>
      <button class="menu-item" data-tab="settings"><span>${icon("settings")}</span><b>Settings</b></button>
    </nav>
  </header>


  <main class="stage">
    <section class="page active" id="page-home">
      <div class="hero-banner">
        <div class="hero-copy"><div class="eyebrow"><span class="eyebrow-dot"></span> YOUTUBE VIDEO DOWNLOADER</div><h1>Your media.<br><span>Your way.</span></h1><p>Download supported videos in your preferred quality</p></div>
        <div class="hero-art"><div class="hero-ring"></div><div class="hero-download">${icon("download")}</div><div class="hero-play">▶</div></div>
        <div class="hero-glow"></div>
      </div>

      <div class="section-heading"><div><span class="section-kicker">GET STARTED</span><h2>New download</h2></div><span class="secure-chip">${icon("shield")} On-device</span></div>
      <div class="download-card">
        <label for="urlInput">PASTE YOUR MEDIA LINK</label>
        <div class="urlbox"><span class="url-icon">${icon("link")}</span><input id="urlInput" type="url" placeholder="Paste YouTube video link here…" autocomplete="url"><button id="clearLinkBtn" class="paste-btn" type="button" aria-label="Clear link" title="Clear link">${icon("cut")}</button></div>
        <select id="quality" hidden><option value="best">Best</option><option value="audio">Audio</option></select>
        
        <button id="downloadBtn" class="primary"><span class="primary-icon">${icon("download")}</span> Load video details <span class="button-arrow">→</span></button>
        <p class="status" id="status" role="status">Only download content you own or are allowed to save.</p>
        <div class="progress-wrap" id="progressWrap" hidden><div class="progress-head"><span id="progressLabel">Connecting…</span><b id="progressValue">0%</b></div><div class="progress-track"><div id="progressBar"></div></div></div>
      </div>
    </section>

    <section class="page" id="page-downloads">
      <div class="page-heading"><div class="eyebrow"><span class="eyebrow-dot"></span> YOUR LIBRARY</div><h2>Downloads</h2><p>Track the current download and latest result.</p></div>
      <div class="download-stats"><div><span class="stat-icon purple">${icon("video")}</span><b id="downloadCount">0</b><small>Saved videos</small></div><div><span class="stat-icon cyan">${icon("speed")}</span><b id="downloadStatus">Ready</b><small>Latest status</small></div></div>
      <div class="download-card manager-card" id="downloadState"><div class="empty-illustration">${icon("download")}</div><b>No downloads yet</b><small>Your download activity will appear here.</small></div>
      <div class="download-list-heading"><div><span class="section-kicker">YOUR FILES</span><h3>Downloaded videos</h3></div><button type="button" class="download-refresh" id="refreshDownloadedBtn" aria-label="Refresh downloaded videos" title="Refresh">${icon("refresh")}</button></div>
      <div id="downloadedFilesList" class="downloaded-files-list"><div class="download-list-empty">Loading downloaded videos…</div></div>
      <p class="storage-note">${icon("shield")} Saved in Internal Storage / Download / NiceDownloader.</p>
    </section>

    <section class="page settings-page" id="page-settings">
      <div class="page-heading"><div class="eyebrow"><span class="eyebrow-dot"></span> APP PREFERENCES</div><h2>Settings</h2><p>Manage where your downloads are saved and check storage access.</p></div>
      <div class="settings-card">
        <div class="settings-title"><span class="settings-icon">${icon("folder")}</span><div><b>Storage setup</b><small>Download folder and permission</small></div><span id="storageBadge" class="settings-badge">Checking…</span></div>
        <div class="storage-location"><small>SAVE LOCATION</small><b id="storageLocation">Download/NiceDownloader</b><p id="storageMethod">Checking Android storage configuration…</p></div>
        <div class="storage-actions">
          <button type="button" class="primary settings-action" id="storageSetupBtn">Set up storage access</button>
          <button type="button" class="settings-secondary" id="openAppSettingsBtn">App permission settings</button>
        </div>
        <p class="settings-help" id="storageHelp">Android 10 and newer use the system Downloads provider. Older Android versions may ask for storage permission.</p>
      </div>
      <div class="settings-card settings-info">
        <div class="settings-title"><span class="settings-icon">${icon("shield")}</span><div><b>Privacy & access</b><small>No all-files access required</small></div></div>
        <p>Nice Downloader saves files in its Download/NiceDownloader folder. It does not need access to all files on your device.</p>
      </div>
    </section>

  </main>

  <div class="format-modal-backdrop" id="playlistModal" hidden>
    <section class="format-modal playlist-modal" role="dialog" aria-modal="true" aria-labelledby="playlistTitle">
      <button type="button" class="format-close" id="playlistClose" aria-label="Close">×</button>
      <div class="format-meta"><h2 id="playlistTitle">YouTube playlist</h2><p id="playlistSubtitle">Videos will download one by one.</p></div>
      <label class="playlist-quality-label" for="playlistQuality">VIDEO QUALITY</label>
      <select id="playlistQuality" class="playlist-quality"><option value="best">Best available</option><option value="1080">Up to 1080p</option><option value="720">Up to 720p</option><option value="480">Up to 480p</option><option value="360">Up to 360p</option><option value="240">Up to 240p</option></select>
      <div id="playlistItems" class="playlist-items"></div>
      <div class="playlist-progress"><div class="progress-head"><span id="playlistProgressLabel">Ready</span><b id="playlistProgressValue">0/0</b></div><div class="progress-track"><div id="playlistProgressBar"></div></div></div>
      <button type="button" class="primary" id="playlistStart">Download playlist one by one</button>
      <p class="format-note">Videos download sequentially. Each video uses the selected maximum quality or the nearest lower available MP4 quality.</p>
    </section>
  </div>
  <div class="format-modal-backdrop playlist-exit-backdrop" id="playlistExitModal" hidden>
    <section class="format-modal playlist-exit-modal" role="dialog" aria-modal="true" aria-labelledby="playlistExitTitle">
      <div class="format-meta"><h2 id="playlistExitTitle">Playlist download is running</h2><p>What would you like to do?</p></div>
      <button type="button" class="primary" id="playlistBackgroundBtn">Continue in background</button>
      <button type="button" class="settings-secondary" id="playlistCancelBtn">Cancel playlist download</button>
    </section>
  </div>
  <div class="format-modal-backdrop" id="formatModal" hidden>
    <section class="format-modal" role="dialog" aria-modal="true" aria-labelledby="formatTitle">
      <button type="button" class="format-close" id="formatClose" aria-label="Close">×</button>
      <div class="format-preview"><img id="formatThumbnail" alt="Video thumbnail" hidden><div id="formatThumbnailFallback">▶</div></div>
      <div class="format-meta"><h2 id="formatTitle">Choose download format</h2><p id="formatSubtitle">Loading video details…</p></div>
      <div class="format-options" id="formatOptions"></div>
      <button type="button" class="primary format-start" id="formatStart" disabled>Download selected format</button>
      <p class="format-note">Only download content you own or are allowed to save.</p>
    </section>
  </div>
</div>`;

const $ = selector => document.querySelector(selector);
const input = $("#urlInput"), status = $("#status"), button = $("#downloadBtn");
const progressWrap = $("#progressWrap");
const progressBar = $("#progressBar"), progressValue = $("#progressValue"), progressLabel = $("#progressLabel");
const downloadState = $("#downloadState");
let progressListener = null;
let downloadSessions = 0;
let activeVideoTitle = "YouTube video";
let activeFormat = null;

function extractYouTubeVideoId(value) {
  const url = validWebUrl(value);
  if (!url) return "";
  const host = url.hostname.toLowerCase().replace(/^www\\./, "");
  if (host === "youtu.be") return url.pathname.split("/").filter(Boolean)[0] || "";
  if (url.pathname === "/watch") return url.searchParams.get("v") || "";
  const parts = url.pathname.split("/").filter(Boolean);
  return ["shorts", "embed", "live"].includes(parts[0]) ? (parts[1] || "") : "";
}

function extractYouTubePlaylistId(value) {
  const raw = String(value || "").trim();
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const isYouTube = host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtu.be";
    if (isYouTube) {
      const id = url.searchParams.get("list") || url.searchParams.get("playlist") || "";
      if (id) return id.trim();
    }
  } catch {}
  const match = raw.match(/[?&]list=([A-Za-z0-9_-]+)/i);
  return match ? match[1] : "";
}

async function readYouTubePlaylist(playlistUrl) {
  const playlistId = extractYouTubePlaylistId(playlistUrl);
  if (!playlistId) throw new Error("Playlist ID was not found in this link.");
  let lastError = null;
  for (const clientType of ["WEB", "ANDROID"]) {
    try {
      const youtube = await getYouTubeClient(clientType);
      const playlist = await youtube.getPlaylist(playlistId);
      const videos = [];
      const seen = new Set();
      const addItems = items => {
        for (const item of items || []) {
          // YouTube has started returning LockupView nodes for playlist videos.
          // Older nodes expose video_id/id; LockupView exposes content_id.
          const id = item.video_id || item.content_id || item.id ||
            item.endpoint?.payload?.videoId ||
            item.navigation_endpoint?.payload?.videoId ||
            item.navigationEndpoint?.payload?.videoId;
          if (!id || seen.has(id) || item.is_unavailable || item.is_private) continue;

          const rawTitle = item.title || item.metadata?.title ||
            item.metadata?.metadata?.title || item.headline;
          let title = rawTitle?.text || rawTitle?.simple_text || rawTitle;
          if (title && typeof title === "object" && typeof title.toString === "function") {
            title = title.toString();
          }
          if (typeof title !== "string" || !title.trim()) title = "YouTube video";

          seen.add(id);
          videos.push({ videoId: id, title: title.trim() });
        }
      };
      addItems(playlist.videos?.items || playlist.videos);
      let pages = 0;
      while (playlist.has_continuation && pages < 50 && videos.length < 500) {
        try {
          const next = await playlist.getContinuation();
          addItems(Array.isArray(next) ? next : (next?.videos?.items || next?.videos || next?.items || []));
          pages += 1;
          if (!next || (!Array.isArray(next) && !next.videos && !next.items)) break;
        } catch (continuationError) {
          if (!videos.length) throw continuationError;
          break;
        }
      }
      if (!videos.length) throw new Error("No accessible videos were found in this playlist.");
      return { playlistId, title: playlist.info?.title?.text || playlist.info?.title || "YouTube playlist", videos };
    } catch (error) { lastError = error; }
  }
  throw new Error("Could not read playlist: " + (lastError?.message || "YouTube request failed"));
}

async function readYouTubeDetails(videoUrl) {
  const videoId = extractYouTubeVideoId(videoUrl);
  if (!videoId) throw new Error("Unsupported YouTube video link.");

  // Use the Android profile first. Once a client returns progressive MP4
  // formats, show the result immediately instead of waiting for slower
  // fallback profiles (iOS and WEB) on every normal link.
  const clientAttempts = ["ANDROID", "WEB", "iOS"];
  let lastError = null;
  let bestInfo = null;
  const formatsByKey = new Map();
  let totalDecipherFailures = 0;

  for (const clientType of clientAttempts) {
    try {
      const youtube = await getYouTubeClient(clientType);
      const info = await youtube.getBasicInfo(videoId);
      const rawFormats = info.streaming_data?.formats || [];
      const formats = [];
      let decipherFailures = 0;

      for (const format of rawFormats) {
        const mimeType = String(format.mime_type || "").toLowerCase();
        if (!format.has_video || !format.has_audio || !mimeType.includes("video/mp4")) continue;
        let streamUrl = "";
        try {
          streamUrl = format.url || await format.decipher(youtube.session.player);
        } catch {
          decipherFailures += 1;
          continue;
        }
        if (!streamUrl || !streamUrl.startsWith("https://")) continue;
        formats.push({
          url: streamUrl,
          height: Number(format.height) || 0,
          ext: "mp4",
          filesize: Number(format.content_length) || 0,
          hasVideo: true,
          hasAudio: true,
          mimeType: "video/mp4",
          quality: format.quality_label || (format.height ? format.height + "p" : "MP4"),
          sourceClient: clientType
        });
      }

      formats.sort((a, b) => b.height - a.height);
      totalDecipherFailures += decipherFailures;

      if (formats.length) {
        if (!bestInfo) bestInfo = { info, clientType };
        // Different YouTube clients expose different progressive MP4 quality
        // levels. Keep querying the fallback clients and merge their choices
        // instead of stopping after the first (often 360p-only) response.
        for (const item of formats) {
          const key = String(item.height || 0) + "|" + item.mimeType;
          const existing = formatsByKey.get(key);
          if (!existing || (item.filesize || 0) > (existing.filesize || 0)) formatsByKey.set(key, item);
        }
      }

      // Keep the first successful metadata response for a useful error
      // when the video has no compatible progressive MP4 stream.
      if (!bestInfo) bestInfo = { info, clientType };
    } catch (error) {
      lastError = error;
    }
  }

  if (!bestInfo) {
    if (lastError) throw new Error("YouTube stream extraction failed: " + (lastError.message || "network or video unavailable"));
    throw new Error("YouTube returned no playable MP4 stream for this video.");
  }

  const bestFormats = Array.from(formatsByKey.values()).sort((a, b) => b.height - a.height);
  const basic = bestInfo.info.basic_info || {};
  const thumbnails = basic.thumbnail || [];
  return {
    videoId,
    title: basic.title || "YouTube video",
    uploader: basic.author || "",
    thumbnail: thumbnails.length ? thumbnails[thumbnails.length - 1].url : "",
    duration: Number(basic.duration) || 0,
    formats: bestFormats,
    decipherFailures: totalDecipherFailures,
    sourceClient: bestInfo.clientType,
    downloadable: bestFormats.length > 0
  };
}

function switchTab(tab) {
  document.querySelectorAll(".page").forEach(page => page.classList.toggle("active", page.id === "page-" + tab));
  document.querySelectorAll("[data-tab]").forEach(item => item.classList.toggle("active", item.dataset.tab === tab));
}
function validWebUrl(value) {
  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const isYouTube = host === "youtube.com" || host.endsWith(".youtube.com") ||
      host === "youtu.be" || host.endsWith(".youtu.be");
    return ["http:", "https:"].includes(url.protocol) && isYouTube ? url : null;
  } catch { return null; }
}
function escapeText(value) {
  return String(value).replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
}
function updateDownloadSummary(label) {
  $("#downloadCount").textContent = String(downloadSessions);
  $("#downloadStatus").textContent = label;
}

document.querySelectorAll("[data-tab]").forEach(item => item.addEventListener("click", () => {
  switchTab(item.dataset.tab);
  if (item.dataset.tab === "downloads") refreshDownloadedFiles();
}));
$("#refreshDownloadedBtn")?.addEventListener("click", refreshDownloadedFiles);

function renderDownloadedFiles(items) {
  const host = $("#downloadedFilesList");
  if (!host) return;
  const files = Array.isArray(items) ? items : [];
  $("#downloadCount").textContent = String(files.length);
  if (!files.length) {
    host.innerHTML = '<div class="download-list-empty"><span>▣</span><b>No downloaded videos yet</b><small>Videos saved by Nice Downloader will appear here automatically.</small></div>';
    return;
  }
  host.innerHTML = files.map((file, index) => {
    const name = escapeText(file.name || "Downloaded video");
    const path = escapeText((file.relativePath || "Download/NiceDownloader").replace(/^Download\\//, "").replace(/\\/$/, ""));
    const size = formatSize(Number(file.size) || 0);
    const date = Number(file.dateAdded) > 0 ? new Date(Number(file.dateAdded) * 1000).toLocaleDateString() : "";
    return '<article class="downloaded-file-row"><div class="downloaded-file-icon">' + icon("video") + '</div><div class="downloaded-file-copy"><b title="' + name + '">' + name + '</b><small>' + escapeText([path, size, date].filter(Boolean).join(" · ")) + '</small></div><span class="downloaded-file-index">' + (index + 1) + '</span></article>';
  }).join("");
}
async function refreshDownloadedFiles() {
  const host = $("#downloadedFilesList");
  if (!host) return;
  if (!Capacitor.isNativePlatform()) {
    host.innerHTML = '<div class="download-list-empty">Downloaded file listing is available in the Android app.</div>';
    return;
  }
  host.innerHTML = '<div class="download-list-empty">Refreshing downloaded videos…</div>';
  try {
    const result = await YtDlp.listDownloadedVideos();
    renderDownloadedFiles(result?.items || []);
  } catch (error) {
    host.innerHTML = '<div class="download-list-empty download-list-error">' + escapeText(error?.message || "Could not load downloaded videos. Tap refresh to retry.") + '</div>';
  }
}

async function refreshStorageSettings() {
  const badge = $("#storageBadge");
  const location = $("#storageLocation");
  const method = $("#storageMethod");
  const action = $("#storageSetupBtn");
  if (!Capacitor.isNativePlatform()) {
    badge.textContent = "Android only";
    location.textContent = "Download/NiceDownloader";
    method.textContent = "Install the Android app to configure device storage.";
    action.disabled = true;
    return;
  }
  try {
    const state = await YtDlp.getStorageStatus();
    location.textContent = state.saveLocation || "Download/NiceDownloader";
    method.textContent = state.method || "Android storage provider";
    badge.textContent = state.storageReady ? "Ready" : "Permission needed";
    badge.classList.toggle("ready", Boolean(state.storageReady));
    action.textContent = state.storageReady ? "Storage is ready" : "Grant storage permission";
    action.disabled = Boolean(state.storageReady);
    $("#storageHelp").textContent = state.legacyPermissionRequired
      ? "Android 9 and below require storage permission to write into the public Downloads folder."
      : "No storage permission is required on this Android version. Files are saved using Android MediaStore.";
  } catch (error) {
    badge.textContent = "Unavailable";
    method.textContent = error?.message || "Could not read storage status.";
    action.disabled = false;
  }
}
$("#storageSetupBtn").addEventListener("click", async () => {
  const action = $("#storageSetupBtn");
  action.disabled = true;
  action.textContent = "Checking permission…";
  try {
    const result = await YtDlp.requestStoragePermission();
    $("#storageHelp").textContent = result.message || (result.storageReady ? "Storage is ready." : "Permission was not granted.");
  } catch (error) {
    $("#storageHelp").textContent = error?.message || "Could not request storage permission.";
  } finally {
    action.disabled = false;
    action.textContent = "Check storage again";
    await refreshStorageSettings();
  }
});
$("#openAppSettingsBtn").addEventListener("click", async () => {
  try { await YtDlp.openAppSettings(); }
  catch (error) { $("#storageHelp").textContent = error?.message || "Could not open Android app settings."; }
});
document.querySelector('[data-tab="settings"]').addEventListener("click", refreshStorageSettings);


let formatLookupInProgress = false;
let loadedFormatsForUrl = "";

async function previewYouTubeLink(value) {
  if (extractYouTubePlaylistId(value)) { await previewYouTubePlaylist(value); return; }
  const url = validWebUrl(value);
  if (!url) {
    status.textContent = "Please paste a valid YouTube video link.";
    return;
  }
  if (!Capacitor.isNativePlatform()) {
    status.textContent = "Video preview and format selection are available in the Android APK.";
    return;
  }
  if (formatLookupInProgress) return;
  if (loadedFormatsForUrl === url.href) {
    $("#formatModal").hidden = false;
    return;
  }
  formatLookupInProgress = true;
  status.textContent = "Loading YouTube video details…";
  button.disabled = true;
  button.innerHTML = '<span class="primary-icon">' + icon("download") + '</span> Loading video…';
  try {
    const info = await readYouTubeDetails(url.href);
    showFormatChoices(info);
    loadedFormatsForUrl = url.href;
    status.textContent = info.formats?.length ? "Video details and MP4 qualities loaded." : "Video details loaded, but no compatible MP4 stream is available.";
  } catch (error) {
    loadedFormatsForUrl = "";
    activeFormat = null;
    status.textContent = "Could not load video details: " + (error?.message || error);
  } finally {
    formatLookupInProgress = false;
    button.disabled = false;
    button.innerHTML = '<span class="primary-icon">' + icon("download") + '</span> Download now';
  }
}

let activePlaylist = null;
let playlistRunning = false;
let playlistCancelRequested = false;

async function previewYouTubePlaylist(value) {
  if (!Capacitor.isNativePlatform()) { status.textContent = "Playlist downloading is available in the Android APK."; return; }
  if (playlistRunning || formatLookupInProgress) return;
  formatLookupInProgress = true;
  button.disabled = true;
  button.textContent = "Loading playlist…";
  status.textContent = "Reading playlist videos…";
  try {
    activePlaylist = await readYouTubePlaylist(value);
    renderPlaylistQueue();
    $("#playlistTitle").textContent = activePlaylist.title;
    $("#playlistSubtitle").textContent = activePlaylist.videos.length + " videos · sequential download";
    $("#playlistModal").hidden = false;
    status.textContent = "Playlist loaded. Choose maximum quality and start.";
  } catch (error) {
    status.textContent = error?.message || "Could not load playlist.";
  } finally {
    formatLookupInProgress = false;
    button.disabled = false;
    button.innerHTML = '<span class="primary-icon">' + icon("download") + '</span> Download now';
  }
}

function renderPlaylistQueue() {
  const host = $("#playlistItems");
  host.innerHTML = "";
  (activePlaylist?.videos || []).forEach((video, index) => {
    const row = document.createElement("div");
    row.className = "playlist-item";
    row.innerHTML = '<span class="playlist-index">' + (index + 1) + '</span><span class="playlist-video-title"></span><span class="playlist-video-state">Queued</span>';
    row.querySelector(".playlist-video-title").textContent = video.title;
    host.append(row);
  });
  $("#playlistProgressValue").textContent = "0/" + (activePlaylist?.videos.length || 0);
  $("#playlistProgressBar").style.width = "0%";
  $("#playlistProgressLabel").textContent = "Ready";
  $("#playlistStart").disabled = false;
  $("#playlistStart").textContent = "Download playlist one by one";
}

function selectPlaylistFormat(formats, requested) {
  const available = (formats || []).filter(f => f.hasVideo && f.hasAudio && f.url && f.mimeType === "video/mp4").sort((a,b) => a.height-b.height);
  if (!available.length) return null;
  if (requested === "best") return available[available.length - 1];
  const maxHeight = Number(requested);
  const under = available.filter(f => f.height <= maxHeight);
  return under[under.length - 1] || available[0];
}

async function runPlaylistDownloads() {
  if (!activePlaylist || playlistRunning) return;
  playlistRunning = true;
  const start = $("#playlistStart");
  start.disabled = true;
  start.textContent = "Downloading…";
  const videos = activePlaylist.videos;
  const requested = $("#playlistQuality").value;
  if (!progressListener) {
    progressListener = await YtDlp.addListener("downloadProgress", event => {
      const pct = Math.max(0, Math.min(100, Number(event.progress) || 0));
      progressBar.style.width = pct + "%";
      progressValue.textContent = Math.round(pct) + "%";
      progressLabel.textContent = event.message || "Downloading…";
      if (playlistRunning) YtDlp.updateBackgroundPlaylist({message: "Playlist download · " + Math.round(pct) + "%"}).catch(() => {});
    });
  }
  let completed = 0, failed = 0;
  try {
    await YtDlp.startBackgroundPlaylist({message: "Starting playlist · " + videos.length + " videos"});
  } catch (error) {
    playlistRunning = false;
    start.disabled = false;
    start.textContent = "Download playlist one by one";
    status.textContent = error?.message || "Could not start background download service.";
    return;
  }
  for (let i = 0; i < videos.length; i++) {
    try {
      const cancelState = await YtDlp.getPlaylistCancelState();
      if (cancelState.cancelled) playlistCancelRequested = true;
    } catch {}
    if (playlistCancelRequested) break;
    const video = videos[i];
    const row = $("#playlistItems").children[i];
    const state = row?.querySelector(".playlist-video-state");
    if (state) state.textContent = "Getting details…";
    $("#playlistProgressLabel").textContent = "Video " + (i+1) + " of " + videos.length + " · fetching details";
    $("#playlistProgressValue").textContent = completed + "/" + videos.length;
    $("#playlistProgressBar").classList.add("is-indeterminate");
    try { await YtDlp.updateBackgroundPlaylist({message: "Getting details for video " + (i+1) + " of " + videos.length}); } catch {}
    try {
      const info = await readYouTubeDetails("https://www.youtube.com/watch?v=" + encodeURIComponent(video.videoId));
      if (playlistCancelRequested) break;
      $("#playlistProgressBar").classList.remove("is-indeterminate");
      const format = selectPlaylistFormat(info.formats, requested);
      if (!format) throw new Error("No compatible MP4 format");
      if (row) row.querySelector(".playlist-video-title").textContent = info.title || video.title;
      if (state) state.textContent = "Downloading " + (format.quality || format.height + "p");
      $("#playlistProgressLabel").textContent = "Video " + (i+1) + " of " + videos.length + " · downloading";
      progressWrap.hidden = false;
      progressBar.style.width = "0%";
      progressValue.textContent = "0%";
      progressLabel.textContent = "Playlist " + (i+1) + "/" + videos.length;
      await YtDlp.downloadStream({streamUrl:format.url,title:info.title || video.title,extension:"mp4",mimeType:"video/mp4",playlistName:activePlaylist.title,playlistIndex:i});
      completed++;
      if (state) state.textContent = "✓ Saved";
    } catch (error) {
      try {
        const cancelState = await YtDlp.getPlaylistCancelState();
        if (cancelState.cancelled) playlistCancelRequested = true;
      } catch {}
      if (playlistCancelRequested) break;
      failed++;
      $("#playlistProgressBar").classList.remove("is-indeterminate");
      const reason = String(error?.message || error || "Unknown error").replace(/\\s+/g, " ").trim();
      const shortReason = reason.length > 34 ? reason.slice(0, 31) + "…" : reason;
      if (state) {
        state.textContent = "Failed: " + shortReason;
        state.title = reason;
        state.setAttribute("aria-label", "Download failed: " + reason);
      }
      if (row) {
        row.title = reason;
        row.setAttribute("aria-label", "Playlist video " + (i + 1) + " failed: " + reason);
      }
    }
    const done = completed + failed;
    $("#playlistProgressValue").textContent = done + "/" + videos.length;
    $("#playlistProgressBar").style.width = (done * 100 / videos.length) + "%";
    $("#playlistProgressLabel").textContent = "Downloaded " + completed + " · Failed " + failed;
  }
  try { await YtDlp.stopBackgroundPlaylist(); } catch {}
  $("#playlistProgressBar").classList.remove("is-indeterminate");
  playlistRunning = false;
  start.disabled = false;
  start.textContent = playlistCancelRequested ? "Playlist cancelled" : "Playlist finished";
  status.textContent = playlistCancelRequested
    ? "Playlist cancelled. " + completed + " videos saved; " + failed + " failed."
    : "Playlist finished: " + completed + " downloaded, " + failed + " failed.";
  downloadSessions += completed;
  updateDownloadSummary(playlistCancelRequested ? "Playlist cancelled" : (failed ? "Playlist partial" : "Playlist complete"));
  await refreshDownloadedFiles();
  if (playlistCancelRequested) $("#playlistModal").hidden = true;
}
$("#playlistClose").addEventListener("click", () => {
  if (playlistRunning) $("#playlistExitModal").hidden = false;
  else $("#playlistModal").hidden = true;
});
$("#playlistBackgroundBtn").addEventListener("click", () => {
  $("#playlistExitModal").hidden = true;
  $("#playlistModal").hidden = true;
  status.textContent = "Playlist is running in the background. Cancel anytime from Downloads or the notification.";
  $("#downloadState").innerHTML = '<b>Playlist downloading in background</b><small id="backgroundPlaylistStatus">Your playlist continues while you use other apps.</small><button type="button" class="primary" id="backgroundPlaylistView">View playlist</button><button type="button" class="settings-secondary" id="backgroundPlaylistCancel">Cancel playlist download</button>';
  $("#backgroundPlaylistView").addEventListener("click", () => {
    if (!activePlaylist) {
      status.textContent = "Playlist details are no longer available. Paste the playlist link again to reload it.";
      switchTab("home");
      return;
    }
    $("#playlistExitModal").hidden = true;
    $("#playlistModal").hidden = false;
  });
  $("#backgroundPlaylistCancel").addEventListener("click", cancelPlaylistFromAnywhere);
  switchTab("downloads");
});
async function cancelPlaylistFromAnywhere() {
  playlistCancelRequested = true;
  try { await YtDlp.cancelDownload(); } catch {}
  try { await YtDlp.updateBackgroundPlaylist({message: "Cancelling playlist…"}); } catch {}
  status.textContent = "Playlist cancellation requested…";
  const btn = $("#backgroundPlaylistCancel");
  if (btn) { btn.disabled = true; btn.textContent = "Cancelling…"; }
}
$("#playlistCancelBtn").addEventListener("click", async () => {
  playlistCancelRequested = true;
  $("#playlistExitModal").hidden = true;
  $("#playlistCancelBtn").disabled = true;
  $("#playlistProgressLabel").textContent = "Cancelling playlist…";
  try { await YtDlp.cancelDownload(); } catch {}
  if (!playlistRunning) $("#playlistModal").hidden = true;
  $("#playlistCancelBtn").disabled = false;
});
$("#playlistStart").addEventListener("click", runPlaylistDownloads);

$("#clearLinkBtn").addEventListener("click", () => {
  input.value = "";
  loadedFormatsForUrl = "";
  activeFormat = null;
  selectedFormat = "best";
  $("#formatModal").hidden = true;
  $("#playlistModal").hidden = true;
  status.textContent = "Link cleared. Paste a new link.";
  input.focus();
});

input.addEventListener("input", () => {
  loadedFormatsForUrl = "";
  activeFormat = null;
  selectedFormat = "best";
});

// Automatically preview when a link is pasted into the URL field.
input.addEventListener("paste", () => {
  window.setTimeout(() => {
    input.value = input.value.trim();
    if (input.value) previewYouTubeLink(input.value);
  }, 0);
});

async function startSelectedDownload() {
  const url = validWebUrl(input.value);
  if (!url) { status.textContent = "Please enter a valid YouTube video link."; input.focus(); return; }
  if (!Capacitor.isNativePlatform()) { status.textContent = "Native downloading is available in the Android APK."; return; }
  button.disabled = true;
  button.innerHTML = '<span class="primary-icon">' + icon("download") + '</span> Starting…';
  progressWrap.hidden = false;
  progressBar.style.width = "0%";
  progressValue.textContent = "0%";
  progressLabel.textContent = "Preparing downloader…";
  status.textContent = "Preparing connection. If the source does not respond, the app will show a timeout.";
  downloadSessions += 1;
  updateDownloadSummary("Active");
  downloadState.innerHTML = '<div class="manager-status active-status"><span class="pulse-dot"></span> ACTIVE DOWNLOAD</div><div class="manager-file-icon">${icon("video")}</div><b>Download in progress</b><small>' + escapeText(url.hostname) + '</small><div class="manager-progress"><span id="managerProgressBar"></span></div><small id="managerProgressText">Connecting to source…</small>';
  try {
    if (!progressListener) {
      progressListener = await YtDlp.addListener("downloadProgress", event => {
        const pct = Math.max(0, Math.min(100, Number(event.progress) || 0));
        progressBar.style.width = pct + "%";
        progressValue.textContent = Math.round(pct) + "%";
        progressLabel.textContent = event.progress > 0 ? (event.etaSeconds > 0 ? "Downloading · ETA " + event.etaSeconds + "s" : "Downloading…") : (event.message || "Connecting to source…");
        const managerBar = $("#managerProgressBar"), managerText = $("#managerProgressText");
        if (managerBar) managerBar.style.width = pct + "%";
        if (managerText) managerText.textContent = Math.round(pct) + "% completed";
      });
    }
    if (!activeFormat?.url) throw new Error("Please select a supported YouTube format first.");
    const result = await YtDlp.downloadStream({streamUrl:activeFormat.url,title:activeVideoTitle,extension:activeFormat.ext,mimeType:activeFormat.mimeType});
    progressBar.style.width = "100%";
    progressValue.textContent = "100%";
    progressLabel.textContent = "Completed";
    status.textContent = result.publicDownload ? "✓ Saved to Internal Storage / Download / NiceDownloader: " + (result.fileName || "video") : "✓ Download completed. App-private file: " + (result.filePath || result.folder || "open app storage");
    updateDownloadSummary("Completed");
    await refreshDownloadedFiles();
    downloadState.innerHTML = '<div class="manager-status complete-status">${icon("check")} COMPLETED</div><div class="manager-file-icon complete-file">${icon("video")}</div><b>Download completed</b><small>' + escapeText(result.folder || "Saved in app Downloads") + '</small>';
  } catch (error) {
    const message = error?.message || String(error);
    status.textContent = "Download failed: " + message;
    progressLabel.textContent = message.toLowerCase().includes("timed out") ? "Connection timed out" : "Download failed";
    updateDownloadSummary("Failed");
    downloadState.innerHTML = '<div class="manager-status failed-status">DOWNLOAD FAILED</div><div class="manager-file-icon failed-file">!</div><b>Could not complete download</b><small>' + escapeText(message) + '</small>';
  } finally {
    button.disabled = false;
    button.innerHTML = '<span class="primary-icon">' + icon("download") + '</span> Download now';
    loadedFormatsForUrl = "";
    activeFormat = null;
    selectedFormat = "best";
  }}

let selectedFormat = "best";
function closeFormatModal() { $("#formatModal").hidden = true; }
$("#formatClose").addEventListener("click", closeFormatModal);
$("#formatModal").addEventListener("click", event => { if (event.target.id === "formatModal") closeFormatModal(); });
function formatSize(bytes) {
  if (!bytes || bytes <= 0) return "";
  const mb = bytes / 1048576;
  return mb >= 1024 ? (mb / 1024).toFixed(1) + " GB" : mb.toFixed(1) + " MB";
}
function showFormatChoices(info) {
  activeVideoTitle = info.title || "YouTube video";
  $("#formatTitle").textContent = activeVideoTitle;
  const duration = Number(info.duration) || 0;
  $("#formatSubtitle").textContent = (info.uploader ? info.uploader + " · " : "") +
    (duration ? Math.floor(duration / 60) + ":" + String(Math.floor(duration % 60)).padStart(2, "0") : "YouTube video");
  const thumb = $("#formatThumbnail");
  if (info.thumbnail && info.thumbnail.startsWith("https://")) {
    thumb.src = info.thumbnail; thumb.hidden = false; $("#formatThumbnailFallback").hidden = true;
    thumb.onerror = () => { thumb.hidden = true; $("#formatThumbnailFallback").hidden = false; };
  } else { thumb.hidden = true; $("#formatThumbnailFallback").hidden = false; }
  const list = $("#formatOptions");
  list.innerHTML = "";
  const videos = (Array.isArray(info.formats) ? info.formats : [])
    .filter(f => f.hasVideo && f.hasAudio && f.url && f.mimeType === "video/mp4")
    .sort((a, b) => b.height - a.height);
  videos.forEach((item, index) => {
    const label = document.createElement("label");
    label.className = "format-choice";
    const radio = document.createElement("input");
    radio.type = "radio"; radio.name = "mediaFormat"; radio.value = "video:" + index; radio.checked = index === 0;
    const detail = document.createElement("span");
    const size = formatSize(item.filesize);
    detail.innerHTML = "<b>" + (item.quality || (item.height + "p")) + "</b><small>MP4 · " + (size || "size varies") + " · video + audio</small>";
    label.append(radio, detail);
    list.append(label);
    radio.addEventListener("change", () => { activeFormat = item; selectedFormat = radio.value; });
  });
  activeFormat = videos[0] || null;
  selectedFormat = videos.length ? "video:0" : "";
  if (!videos.length) {
    const notice = document.createElement("div");
    notice.className = "format-unavailable";
    notice.textContent = "No compatible combined MP4 stream was returned for this video. Try another public video or network.";
    list.append(notice);
  }
  $("#formatStart").disabled = videos.length === 0;
  $("#formatStart").textContent = videos.length ? "Download MP4 video" : "No MP4 stream available";
  $("#formatModal").hidden = false;
}
const shell = document.querySelector(".app-shell");
input.addEventListener("focus", () => {
  shell?.classList.add("keyboard-open");
  window.setTimeout(() => input.scrollIntoView({block:"start", behavior:"smooth"}), 180);
});
input.addEventListener("blur", () => {
  window.setTimeout(() => {
    if (!input.matches(":focus")) shell?.classList.remove("keyboard-open");
  }, 220);
});
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", () => {
    if (input.matches(":focus")) shell?.classList.add("keyboard-open");
  });
}
button.addEventListener("click", async () => {
  const url = validWebUrl(input.value);
  if (!url) { status.textContent = "Please enter a valid YouTube video link."; input.focus(); return; }
  await previewYouTubeLink(url.href);
});
$("#formatStart").addEventListener("click", async () => {
  $("#quality").value = selectedFormat; closeFormatModal(); await startSelectedDownload();
});
