const I18N = {
  zh: {
    statusOnline: "在线",
    statusOffline: "未运行",
    placeholder: "粘贴链接或磁力…",
    grab: "下载",
    autoGrab: "自动拦截浏览器下载",
    recent: "最近任务",
    empty: "暂无任务",
    sent: "已发送",
    fail: "应用未运行",
    downloading: "下载中",
    completed: "完成",
    paused: "暂停",
    queued: "排队",
    error: "出错",
    canceled: "取消",
    video: "视频",
    sentVideo: "视频任务已发送",
    failVideo: "应用未运行或缺少工具",
    playlist: "播放列表",
    sentPlaylist: "播放列表已发送",
    failPlaylist: "应用未运行",
    notPlaylist: "当前页面不是播放列表",
    magnetSent: "磁力链接已发送",
    tokenPlaceholder: "API 令牌…",
    tokenHint: "从应用「设置 → 扩展」复制",
    tokenSaved: "令牌已保存",
    settings: "设置",
  },
  en: {
    statusOnline: "Online",
    statusOffline: "Offline",
    placeholder: "Paste URL or magnet link…",
    grab: "Download",
    autoGrab: "Auto-grab downloads",
    recent: "Recent Tasks",
    empty: "No tasks yet",
    sent: "Sent to SpeedDownloader",
    fail: "App is not running",
    downloading: "Downloading",
    completed: "Done",
    paused: "Paused",
    queued: "Queued",
    error: "Error",
    canceled: "Canceled",
    video: "Video",
    sentVideo: "Video task sent",
    failVideo: "App not running or tools missing",
    playlist: "Playlist",
    sentPlaylist: "Playlist sent",
    failPlaylist: "App not running",
    notPlaylist: "Not a playlist page",
    magnetSent: "Magnet link sent",
    tokenPlaceholder: "API Token…",
    tokenHint: "Copy from app: Settings \u2192 Extension",
    tokenSaved: "Token saved",
    settings: "Settings",
  },
};

const VIDEO_HOSTS = [
  "youtube.com", "youtu.be", "twitter.com", "x.com",
  "bilibili.com", "tiktok.com", "instagram.com",
  "facebook.com", "fb.watch", "vimeo.com",
  "dailymotion.com", "twitch.tv", "reddit.com", "redd.it",
  "vk.com", "ok.ru", "nicovideo.jp", "nico.ms",
  "douyin.com", "ixigua.com", "v.qq.com",
  "iqiyi.com", "youku.com", "mgtv.com",
];

let lang = navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
chrome.storage.sync.get({ lang }, (v) => { lang = v.lang || lang; applyLang(); });

const $ = (id) => document.getElementById(id);
const t = (key) => I18N[lang][key] || I18N.en[key];

function applyLang() {
  $("urlInput").placeholder = t("placeholder");
  $("grabBtn").textContent = t("grab");
  $("grabVideoBtn").innerHTML = '<span class="btn-icon">\uD83C\uDFAC</span> ' + t("video");
  $("grabPlaylistBtn").innerHTML = '<span class="btn-icon">\uD83D\uDCCB</span> ' + t("playlist");
  $("autoGrabText").textContent = t("autoGrab");
  $("tasksTitle").textContent = t("recent");
  $("taskEmpty").querySelector("p").textContent = t("empty");
  $("tokenInput").placeholder = t("tokenPlaceholder");
  $("tokenHint").textContent = t("tokenHint");
  $("settings").querySelector("summary").textContent = t("settings");
}

function setStatus(online) {
  $("dot").className = "dot " + (online ? "on" : "off");
  $("statusText").textContent = online ? t("statusOnline") : t("statusOffline");
}

function isVideoHost(url) {
  try {
    const u = url.trim().toLowerCase();
    if (!/^https?:\/\//i.test(u)) return false;
    return VIDEO_HOSTS.some((h) => u.includes("://" + h) || u.includes("www." + h));
  } catch { return false; }
}

function isPlaylistUrl(url) {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtube.com") || u.hostname.includes("youtu.be"))
      return u.searchParams.has("list") || url.includes("/playlist");
    if (u.hostname.includes("bilibili.com"))
      return url.includes("/space/channel/seriesdetail") || url.includes("/list/");
    return false;
  } catch { return false; }
}

function statusClass(s) { return "tag-" + s.toLowerCase(); }

function statusLabel(s) {
  const map = { Downloading: "downloading", Completed: "completed", Paused: "paused", Queued: "queued", Error: "error", Canceled: "canceled" };
  return t(map[s] || "queued");
}

function formatBytes(n) {
  if (!Number.isFinite(n) || n < 0) return "\u2014";
  if (n < 1024) return Math.round(n) + " B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return v.toFixed(v >= 100 || i === 0 ? 0 : 1) + " " + units[i];
}

function fileIcon(name) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  const map = {
    zip: ["\uD83D\uDCE6", "#eab308", "rgba(234,179,8,.1)"],
    rar: ["\uD83D\uDCE6", "#eab308", "rgba(234,179,8,.1)"],
    "7z": ["\uD83D\uDCE6", "#eab308", "rgba(234,179,8,.1)"],
    exe: ["\uD83D\uDCBB", "#38bdf8", "rgba(56,189,248,.1)"],
    msi: ["\uD83D\uDCBB", "#38bdf8", "rgba(56,189,248,.1)"],
    apk: ["\uD83D\uDCF1", "#22c55e", "rgba(34,197,94,.1)"],
    iso: ["\uD83D\uDCBF", "#a78bfa", "rgba(167,139,250,.1)"],
    mp4: ["\uD83C\uDFAC", "#a78bfa", "rgba(167,139,250,.1)"],
    mkv: ["\uD83C\uDFAC", "#a78bfa", "rgba(167,139,250,.1)"],
    webm: ["\uD83C\uDFAC", "#a78bfa", "rgba(167,139,250,.1)"],
    mp3: ["\uD83C\uDFB5", "#fb7185", "rgba(251,113,133,.1)"],
    pdf: ["\uD83D\uDCC4", "#f87171", "rgba(248,113,113,.1)"],
  };
  const fallback = ["\uD83D\uDCC4", "#8891ad", "rgba(136,145,173,.1)"];
  const [ch, color, bg] = map[ext] || fallback;
  return { ch, color, bg };
}

function renderTasks(tasks) {
  const list = $("taskList");
  const empty = $("taskEmpty");
  const count = $("taskCount");
  list.innerHTML = "";
  if (!tasks.length) {
    empty.style.display = "block";
    count.textContent = "";
    return;
  }
  empty.style.display = "none";
  const shown = tasks.slice(0, 8);
  count.textContent = tasks.length > shown.length ? shown.length + "/" + tasks.length : "" + tasks.length;

  shown.forEach((task) => {
    const el = document.createElement("div");
    el.className = "task";
    const icon = fileIcon(task.filename);
    const pct = task.total_size > 0 ? Math.min(100, (task.downloaded / task.total_size) * 100) : 0;

    let meta = "";
    if (task.status === "Downloading") {
      meta = '<div class="progress-bar"><div class="progress-fill" style="width:' + pct + '%"></div></div>'
        + '<div class="progress-info"><span>' + formatBytes(task.downloaded) + " / " + formatBytes(task.total_size) + "</span>"
        + (task.speed > 0 ? "<span> \u00B7 " + formatBytes(task.speed) + "/s</span>" : "") + "</div>";
    } else {
      meta = "<span>" + formatBytes(task.total_size || task.downloaded) + "</span>";
    }

    el.innerHTML = '<div class="ic" style="background:' + icon.bg + ";color:" + icon.color + '">' + icon.ch + "</div>"
      + '<div class="info"><div class="name" title="' + task.filename + '">' + task.filename + "</div>"
      + '<div class="meta">' + meta + "</div></div>"
      + '<span class="tag ' + statusClass(task.status) + '">' + statusLabel(task.status) + "</span>";

    if (task.url.length > 50) el.title = task.url;
    list.appendChild(el);
  });
}

async function refresh() {
  const online = await new Promise((res) =>
    chrome.runtime.sendMessage({ type: "SD_HEALTH" }, (r) => res(!!(r && r.ok)))
  );
  setStatus(online);
  const tasks = await new Promise((res) =>
    chrome.runtime.sendMessage({ type: "SD_TASKS" }, (r) => res(Array.isArray(r) ? r : []))
  );
  renderTasks(tasks);
  return online;
}

function toast(msg, ok) {
  const prev = document.querySelector(".toast");
  if (prev) prev.remove();
  const el = document.createElement("div");
  el.className = "toast " + (ok ? "ok" : "err");
  el.textContent = msg;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 250);
  }, 2000);
}

// Smart URL detection
$("urlInput").addEventListener("input", () => {
  const url = $("urlInput").value.trim();
  $("grabBtn").classList.remove("url-matched");
  $("grabVideoBtn").classList.remove("url-matched");
  $("grabPlaylistBtn").classList.remove("url-matched");
  if (!url) return;
  if (isPlaylistUrl(url)) {
    $("grabPlaylistBtn").classList.add("url-matched");
  } else if (isVideoHost(url)) {
    $("grabVideoBtn").classList.add("url-matched");
  } else {
    $("grabBtn").classList.add("url-matched");
  }
});

$("urlInput").addEventListener("paste", () => {
  setTimeout(() => $("urlInput").dispatchEvent(new Event("input")), 10);
});

// Grab download
$("grabBtn").addEventListener("click", async () => {
  const url = $("urlInput").value.trim();
  if (!url) return;
  $("grabBtn").disabled = true;
  const isMagnet = url.startsWith("magnet:") || url.endsWith(".torrent");
  const type = isMagnet ? "SD_GRAB_MAGNET" : "SD_GRAB";
  const r = await new Promise((res) =>
    chrome.runtime.sendMessage({ type, url }, (resp) => res(resp || { ok: false }))
  );
  $("grabBtn").disabled = false;
  toast(r.ok ? (isMagnet ? t("magnetSent") : t("sent")) : t("fail"), !!r.ok);
  if (r.ok) { $("urlInput").value = ""; refresh(); }
});

// Grab video
$("grabVideoBtn").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url) return;
  $("grabVideoBtn").disabled = true;
  const r = await new Promise((res) =>
    chrome.runtime.sendMessage({ type: "SD_VIDEO_GRAB", url: tab.url }, (resp) => res(resp || { ok: false }))
  );
  $("grabVideoBtn").disabled = false;
  toast(r.ok ? t("sentVideo") : t("failVideo"), !!r.ok);
  if (r.ok) refresh();
});

// Grab playlist
$("grabPlaylistBtn").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url) return;
  $("grabPlaylistBtn").disabled = true;
  const r = await new Promise((res) =>
    chrome.runtime.sendMessage({ type: "SD_PLAYLIST_GRAB", url: tab.url }, (resp) => res(resp || { ok: false }))
  );
  $("grabPlaylistBtn").disabled = false;
  toast(r.ok ? t("sentPlaylist") : (r.error === "not_playlist" ? t("notPlaylist") : t("failPlaylist")), !!r.ok);
  if (r.ok) refresh();
});

// Auto-grab toggle
$("autoGrab").addEventListener("change", (e) => {
  chrome.storage.sync.set({ autoGrab: e.target.checked });
});
chrome.storage.sync.get({ autoGrab: true }, (v) => { $("autoGrab").checked = v.autoGrab; });

// API token
chrome.storage.sync.get({ apiToken: "" }, (v) => { $("tokenInput").value = v.apiToken || ""; });
$("tokenInput").addEventListener("change", () => {
  const token = $("tokenInput").value.trim();
  chrome.runtime.sendMessage({ type: "SD_SET_TOKEN", token });
  chrome.storage.sync.set({ apiToken: token });
  toast(t("tokenSaved"), true);
  setTimeout(refresh, 300);
});

refresh();
setInterval(refresh, 4000);
