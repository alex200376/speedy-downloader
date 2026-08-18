const API_BASE = "http://127.0.0.1:47812";

const zh = (navigator.language || "").toLowerCase().startsWith("zh");

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
  return fetch(`${API_BASE}/api/v1/health`, { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => (j && j.ok ? j.data : null))
    .catch(() => null);
}

function sendToApp(url, filename, referer, confirm) {
  return fetch(`${API_BASE}/api/v1/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, filename, referer, confirm }),
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

chrome.downloads.onCreated.addListener(async (item) => {
  const { autoGrab = true } = await chrome.storage.sync.get("autoGrab");
  if (!autoGrab) return;
  if (!item.url || !/^https?:\/\//i.test(item.url)) return;
  if (item.filename && /\.(crdownload|part)$/i.test(item.filename)) return;

  try {
    await downloads.pause(item.id);
  } catch (e) {}

  const referer = item.referrer || undefined;
  const result = await sendToApp(item.url, item.filename, referer, true);

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
  updateBadge();
});

chrome.runtime.onStartup.addListener(() => updateBadge());

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const url = info.linkUrl || info.srcUrl || (tab ? tab.url : undefined);
  if (!url) return;
  const referer = tab && tab.url ? tab.url : undefined;
  const filename = filenameFromUrl(url);
  sendToApp(url, filename, referer, true).then((r) => {
    if (r && r.ok) updateBadge();
    else if (r && r.error) notify(zh ? `未能添加下载：${r.error}` : `Failed to add download: ${r.error}`);
  });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== "string") return;

  if (msg.type === "SD_GRAB") {
    const referer = msg.referer || (sender && sender.tab && sender.tab.url) || undefined;
    sendToApp(msg.url, msg.filename, referer, true).then((r) => {
      sendResponse(r);
      if (r && r.ok) updateBadge();
      else if (r && r.error) notify(zh ? `未能添加下载：${r.error}` : `Failed to add download: ${r.error}`);
    });
    return true;
  }

  if (msg.type === "SD_HEALTH") {
    health().then((h) => sendResponse({ ok: !!h, health: h }));
    return true;
  }

  if (msg.type === "SD_TASKS") {
    fetch(`${API_BASE}/api/v1/tasks`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => sendResponse(j && j.ok ? (j.data || []) : []))
      .catch(() => sendResponse([]));
    return true;
  }
});