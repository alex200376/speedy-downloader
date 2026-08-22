const API_BASE = "http://127.0.0.1:47812";

const zh = (navigator.language || "").toLowerCase().startsWith("zh");

// Per-install API auth token. Populated from chrome.storage.sync at startup and
// via the popup (SD_SET_TOKEN). Sent as Authorization: Bearer on every request.
let apiToken = "";
chrome.storage.sync.get(["apiToken"]).then((s) => {
  apiToken = (s && s.apiToken) || "";
});

function apiFetch(url, opts = {}) {
  const headers = Object.assign({}, opts.headers || {});
  if (apiToken) headers["Authorization"] = `Bearer ${apiToken}`;
  return fetch(url, Object.assign({}, opts, { headers }));
}

function notify(message) {
  try {
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: "SpeedDownloader",
      message,
      priority: 1,
    });
  } catch (e) {}
}

function health() {
  return apiFetch(`${API_BASE}/api/v1/health`, { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => (j && j.ok ? j.data : null))
    .catch(() => null);
}

function sendToApp(url, filename, referer, confirm, kind) {
  return apiFetch(`${API_BASE}/api/v1/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, filename, referer, confirm, kind }),
  })
    .then((r) => r.json())
    .catch(() => ({ ok: false, error: "app offline" }));
}

function filenameFromUrl(url) {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").filter(Boolean).pop();
    return last ? decodeURIComponent(last) : undefined;
  } catch {
    return undefined;
  }
}

const downloads = {
  pause: (id) => new Promise((res) => chrome.downloads.pause(id, () => res())),
  cancel: (id) => new Promise((res) => chrome.downloads.cancel(id, () => res())),
  resume: (id) => new Promise((res) => chrome.downloads.resume(id, () => res())),
  removeFile: (id) => new Promise((res) => chrome.downloads.removeFile(id, () => res())),
};

async function updateBadge() {
  const online = await health();
  const badge = chrome.action;
  if (online) {
    badge.setBadgeBackgroundColor({ color: "#10b981" });
    badge.setBadgeText({ text: "✓" });
  } else {
    badge.setBadgeBackgroundColor({ color: "#f43f5e" });
    badge.setBadgeText({ text: "!" });
  }
  return online;
}

function existingTask(url) {
  return apiFetch(`${API_BASE}/api/v1/tasks`, { cache: "no-store" })
    .then((r) => r.json())
    .then((j) => {
      if (!j || !j.ok || !j.data) return null;
      return j.data.find((t) => t.url === url) || null;
    })
    .catch(() => null);
}

const VIDEO_HOSTS = [
  "youtube.com", "youtu.be", "twitter.com", "x.com",
  "bilibili.com", "tiktok.com", "instagram.com", "facebook.com",
  "vimeo.com", "dailymotion.com", "twitch.tv", "reddit.com",
  "douyin.com", "v.qq.com", "iqiyi.com", "youku.com",
];

function isVideoSite(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    return VIDEO_HOSTS.some((h) => host === h || host.endsWith("." + h));
  } catch {
    return false;
  }
}

chrome.downloads.onCreated.addListener(async (item) => {
  const { autoGrab = true } = await chrome.storage.sync.get("autoGrab");
  if (!autoGrab) return;
  // Support magnet links and torrent files too
  if (!item.url || (!/^https?:\/\//i.test(item.url) && !item.url.startsWith("magnet:") && !item.url.endsWith(".torrent"))) return;
  if (item.filename && /\.(crdownload|part)$/i.test(item.filename)) return;

  const dup = await existingTask(item.url);
  if (dup) {
    notify(
      zh
        ? `已在任务列表中，跳过重复抓取`
        : `Already in task list, skipping duplicate grab`,
    );
    return;
  }

  try {
    await downloads.pause(item.id);
  } catch (e) {}

  const referer = item.referrer || undefined;
  const kind = isVideoSite(item.url) ? "video" : "http";
  const result = await sendToApp(item.url, item.filename, referer, true, kind);

  if (result && result.ok) {
    try {
      await downloads.cancel(item.id);
      await downloads.removeFile(item.id);
    } catch (e) {}
  } else {
    try {
      await downloads.resume(item.id);
    } catch (e) {}
    const reason = result && result.error ? result.error : "offline";
    notify(
      zh
        ? `未能接管下载${reason === "offline" ? "：极速下载器未运行" : `：${reason}`}，已用 Chrome 继续下载`
        : `Grab failed${reason === "offline" ? ": app not running" : `: ${reason}`}, Chrome is downloading instead`,
    );
  }
  updateBadge();
});

function isPlaylistUrl(url) {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtube.com") || u.hostname.includes("youtu.be")) {
      return u.searchParams.has("list") || url.includes("/playlist") || url.includes("/channel/") || url.includes("/user/");
    }
    if (u.hostname.includes("bilibili.com")) {
      return url.includes("/space/channel/seriesdetail") || url.includes("/list/");
    }
    return false;
  } catch {
    return false;
  }
}

function isMagnetOrTorrent(url) {
  return url.startsWith("magnet:") || url.endsWith(".torrent") || (url.includes("://") && url.includes(".torrent"));
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "sd-download-link",
    title: "Download with SpeedDownloader",
    contexts: ["link"],
  });
  chrome.contextMenus.create({
    id: "sd-download-link-zh",
    title: "用极速下载器下载",
    contexts: ["link"],
  });
  chrome.contextMenus.create({
    id: "sd-download-media",
    title: "Download with SpeedDownloader",
    contexts: ["video", "audio", "image"],
  });
  chrome.contextMenus.create({
    id: "sd-video-page",
    title: "Download video with SpeedDownloader",
    contexts: ["page"],
  });
  chrome.contextMenus.create({
    id: "sd-playlist",
    title: "Download playlist with SpeedDownloader",
    contexts: ["page"],
  });
  chrome.contextMenus.create({
    id: "sd-magnet",
    title: "Download with SpeedDownloader",
    contexts: ["link"],
  });
  updateBadge();
});

chrome.runtime.onStartup.addListener(() => updateBadge());

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const url = info.linkUrl || info.srcUrl || (tab ? tab.url : undefined);
  if (!url) return;
  const referer = tab && tab.url ? tab.url : undefined;
  const filename = filenameFromUrl(url);

  // Playlist detection
  if (info.menuItemId === "sd-playlist") {
    if (isPlaylistUrl(url)) {
      apiFetch(`${API_BASE}/api/v1/playlist/open`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      })
        .then((r) => r.json())
        .then((j) => {
          if (j && j.ok) {
            updateBadge();
            notify(zh ? `播放列表已发送到极速下载器` : `Playlist sent to SpeedDownloader`);
          } else {
            notify(zh ? `未能打开播放列表` : `Failed to open playlist`);
          }
        })
        .catch(() => notify(zh ? `极速下载器未运行` : `App is not running`));
    } else {
      notify(zh ? `此页面不是播放列表` : `This page is not a playlist`);
    }
    return;
  }

  // Magnet link detection
  if (info.menuItemId === "sd-magnet" || isMagnetOrTorrent(url)) {
    sendToApp(url, filename || "torrent", referer, true, "http").then((r) => {
      if (r && r.ok) updateBadge();
      else if (r && r.error) notify(zh ? `未能添加下载：${r.error}` : `Failed to add download: ${r.error}`);
    });
    return;
  }

  const kind = info.menuItemId === "sd-video-page" && tab ? "video" : "http";
  const targetUrl = kind === "video" && tab ? tab.url : url;
  sendToApp(targetUrl, filename, referer, true, kind).then((r) => {
    if (r && r.ok) updateBadge();
    else if (r && r.error) notify(zh ? `未能添加下载：${r.error}` : `Failed to add download: ${r.error}`);
  });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== "string") return;

if (msg.type === "SD_GRAB" || msg.type === "SD_VIDEO_GRAB" || msg.type === "SD_GRAB_MAGNET") {
  const kind = msg.type === "SD_VIDEO_GRAB" ? "video" : "http";
  const referer = msg.referer || (sender && sender.tab && sender.tab.url) || undefined;
  sendToApp(msg.url, msg.filename, referer, true, kind).then((r) => {
    sendResponse(r);
    if (r && r.ok) updateBadge();
    else if (r && r.error) notify(zh ? `未能添加下载：${r.error}` : `Failed to add download: ${r.error}`);
  });
  return true;
}

  if (msg.type === "SD_PLAYLIST_GRAB") {
    // Open the playlist dialog in the app instead of creating a single task
    apiFetch(`${API_BASE}/api/v1/playlist/open`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: msg.url }),
    })
      .then((r) => r.json())
      .then((j) => {
        sendResponse(j && j.ok ? { ok: true } : { ok: false, error: j?.error || "failed" });
        updateBadge();
      })
      .catch(() => sendResponse({ ok: false, error: "app offline" }));
    return true;
  }

  if (msg.type === "SD_HEALTH") {
    health().then((h) => sendResponse({ ok: !!h, health: h }));
    return true;
  }

  if (msg.type === "SD_SET_TOKEN") {
    apiToken = (msg.token || "").trim();
    chrome.storage.sync.set({ apiToken: apiToken });
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === "SD_TASKS") {
    apiFetch(`${API_BASE}/api/v1/tasks`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => sendResponse(j && j.ok ? (j.data || []) : []))
      .catch(() => sendResponse([]));
    return true;
  }
});