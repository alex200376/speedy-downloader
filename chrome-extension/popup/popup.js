const I18N = {
  zh: {
    statusOnline: "应用在线",
    statusOffline: "应用未运行",
    placeholder: "https://example.com/file.zip",
    grab: "⚡ 下载",
    autoGrab: "自动拦截浏览器下载",
    recent: "最近任务",
    empty: "暂无任务，抓取下载后会显示在这里",
    sent: "已发送到极速下载器",
    fail: "极速下载器未运行，请先打开应用",
    downloading: "下载中",
    completed: "完成",
    paused: "暂停",
    queued: "排队",
    error: "出错",
    canceled: "取消",
  },
  en: {
    statusOnline: "App online",
    statusOffline: "App is not running",
    placeholder: "https://example.com/file.zip",
    grab: "⚡ Download",
    autoGrab: "Auto-grab browser downloads",
    recent: "Recent tasks",
    empty: "No tasks yet — downloads will show here",
    sent: "Sent to SpeedDownloader",
    fail: "SpeedDownloader is not running. Start the app first.",
    downloading: "Downloading",
    completed: "Completed",
    paused: "Paused",
    queued: "Queued",
    error: "Error",
    canceled: "Canceled",
  },
};

let lang = navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
chrome.storage.sync.get({ lang }, (v) => {
  lang = v.lang || lang;
  applyLang();
});

const $ = (id) => document.getElementById(id);
const t = (key) => I18N[lang][key] || I18N.en[key];

function applyLang() {
  $("urlInput").placeholder = t("placeholder");
  $("grabBtn").textContent = t("grab");
  $("autoGrabText").textContent = t("autoGrab");
  $("tasksTitle").textContent = t("recent");
  $("taskEmpty").textContent = t("empty");
}

function setStatus(online) {
  $("dot").className = "dot " + (online ? "on" : "off");
  $("statusText").textContent = online ? t("statusOnline") : t("statusOffline");
}

function statusClass(s) {
  return "tag-" + s.toLowerCase();
}

function statusLabel(s) {
  const map = {
    Downloading: "downloading",
    Completed: "completed",
    Paused: "paused",
    Queued: "queued",
    Error: "error",
    Canceled: "canceled",
  };
  return t(map[s] || "queued");
}

function renderTasks(tasks) {
  const list = $("taskList");
  list.innerHTML = "";
  const empty = $("taskEmpty");
  if (!tasks.length) {
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";
  tasks.slice(0, 7).forEach((task) => {
    const el = document.createElement("div");
    el.className = "task";
    const icon = fileIcon(task.filename);
    el.innerHTML = `
      <div class="ic" style="background:${icon.bg};color:${icon.color}">${icon.ch}</div>
      <div class="info">
        <div class="name"></div>
        <div class="meta"></div>
      </div>
      <span class="tag ${statusClass(task.status)}">${statusLabel(task.status)}</span>`;
    el.querySelector(".name").textContent = task.filename;
    const size = formatBytes(task.total_size || task.downloaded);
    el.querySelector(".meta").textContent = size + " · " + task.url;
    list.appendChild(el);
  });
}

function formatBytes(n) {
  if (!n || n <= 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return v.toFixed(v >= 100 || i === 0 ? 0 : 1) + " " + units[i];
}

function fileIcon(name) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  const map = {
    zip: ["📦", "#f59e0b", "rgba(245,158,11,.12)"],
    rar: ["🗜️", "#f59e0b", "rgba(245,158,11,.12)"],
    "7z": ["🗜️", "#f59e0b", "rgba(245,158,11,.12)"],
    exe: ["🖥️", "#38bdf8", "rgba(56,189,248,.12)"],
    msi: ["🖥️", "#38bdf8", "rgba(56,189,248,.12)"],
    apk: ["📱", "#34d399", "rgba(52,211,153,.12)"],
    iso: ["💿", "#c084fc", "rgba(192,132,252,.12)"],
    mp4: ["🎬", "#a78bfa", "rgba(167,139,250,.12)"],
    mkv: ["🎬", "#a78bfa", "rgba(167,139,250,.12)"],
    mp3: ["🎵", "#fb7185", "rgba(251,113,133,.12)"],
    pdf: ["📄", "#f87171", "rgba(248,113,113,.12)"],
    txt: ["📃", "#94a3b8", "rgba(148,163,184,.12)"],
  };
  const [ch, color, bg] = map[ext] || ["📄", "#94a3b8", "rgba(148,163,184,.12)"];
  return { ch, color, bg };
}

async function refresh() {
  const online = await new Promise((res) =>
    chrome.runtime.sendMessage({ type: "SD_HEALTH" }, (r) => res(!!(r && r.ok))),
  );
  setStatus(online);
  const tasks = await new Promise((res) =>
    chrome.runtime.sendMessage({ type: "SD_TASKS" }, (r) => res(Array.isArray(r) ? r : [])),
  );
  renderTasks(tasks);
  return online;
}

function toast(msg, ok) {
  const el = document.createElement("div");
  el.textContent = msg;
  el.style.cssText = `position:fixed;left:14px;right:14px;bottom:14px;z-index:9;padding:9px 12px;border-radius:10px;font-size:12px;font-weight:600;color:${ok ? "#10b981" : "#f43f5e"};background:#0a0f1c;border:1px solid rgba(255,255,255,.08);box-shadow:0 8px 24px rgba(0,0,0,.4);opacity:0;transition:opacity .2s;`;
  document.body.appendChild(el);
  requestAnimationFrame(() => (el.style.opacity = "1"));
  setTimeout(() => {
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 220);
  }, 2000);
}

$("grabBtn").addEventListener("click", async () => {
  const url = $("urlInput").value.trim();
  if (!url) return;
  $("grabBtn").disabled = true;
  const r = await new Promise((res) =>
    chrome.runtime.sendMessage({ type: "SD_GRAB", url }, (resp) => res(resp || { ok: false })),
  );
  $("grabBtn").disabled = false;
  toast(r.ok ? t("sent") : t("fail"), !!r.ok);
  if (r.ok) {
    $("urlInput").value = "";
    refresh();
  }
});

$("autoGrab").addEventListener("change", (e) => {
  chrome.storage.sync.set({ autoGrab: e.target.checked });
});

chrome.storage.sync.get({ autoGrab: true }, (v) => {
  $("autoGrab").checked = v.autoGrab;
});

refresh();
setInterval(refresh, 4000);