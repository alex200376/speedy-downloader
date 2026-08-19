(() => {
  if (window.__SD_CONTENT__) return;
  window.__SD_CONTENT__ = true;

  const SVG = `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg>`;

  const i18n = {
    zh: { label: "用极速下载器下载", sent: "已发送到极速下载器", fail: "极速下载器未运行" },
    en: { label: "Download with SpeedDownloader", sent: "Sent to SpeedDownloader", fail: "SpeedDownloader is not running" },
  };
  let lang = navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
  chrome.storage.sync.get({ lang }, (v) => {
    lang = v.lang || lang;
  });

  const text = () => i18n[lang] || i18n.en;

  function makeButton() {
    const b = document.createElement("button");
    b.style.cssText = [
      "position:absolute",
      "z-index:2147483645",
      "display:inline-flex",
      "align-items:center",
      "gap:5px",
      "padding:4px 9px",
      "border-radius:8px",
      "border:none",
      "font:600 11.5px/1.4 'Segoe UI',system-ui,sans-serif",
      "color:#fff",
      "cursor:pointer",
      "background:linear-gradient(135deg,#6366f1,#8b5cf6)",
      "box-shadow:0 4px 14px rgba(99,102,241,.45)",
      "white-space:nowrap",
    ].join(";");
    b.innerHTML = `${SVG}<span>${text().label}</span>`;
    b.addEventListener("mousedown", (e) => e.stopPropagation());
    b.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const url = b.dataset.url;
      const filename = b.dataset.filename || undefined;
      if (!url) return;
      chrome.runtime.sendMessage({ type: "SD_GRAB", url, filename, referer: location.href }, (r) => {
        const ok = r && r.ok;
        toast(ok ? text().sent : text().fail, ok);
        b.remove();
      });
    });
    return b;
  }

  function toast(msg, ok) {
    const el = document.createElement("div");
    el.textContent = msg;
    el.style.cssText = [
      "position:fixed",
      "top:14px",
      "right:14px",
      "z-index:2147483647",
      "padding:9px 14px",
      "border-radius:10px",
      "font:600 12.5px 'Segoe UI',system-ui,sans-serif",
      `color:${ok ? "#10b981" : "#f43f5e"}`,
      "background:rgba(15,21,36,.92)",
      "border:1px solid rgba(255,255,255,.08)",
      "box-shadow:0 8px 24px rgba(0,0,0,.35)",
      "opacity:0",
      "transition:opacity .2s",
    ].join(";");
    document.documentElement.appendChild(el);
    requestAnimationFrame(() => (el.style.opacity = "1"));
    setTimeout(() => {
      el.style.opacity = "0";
      setTimeout(() => el.remove(), 250);
    }, 1800);
  }

  let btn = null;
  function hideBtn() {
    if (btn) {
      btn.remove();
      btn = null;
    }
  }

  function isDownloadable(a) {
    const href = a.href || "";
    if (!href || href.startsWith("javascript:") || href.startsWith("#") || href.startsWith("blob:")) return false;
    if (a.hasAttribute("download")) return true;
    if (/\.(zip|rar|7z|tar|gz|bz2|xz|exe|msi|apk|dmg|deb|rpm|iso|mp4|mkv|webm|mov|mp3|flac|wav|pdf|djvu|pak|bin|img)(\?|#|$)/i.test(href)) return true;
    return false;
  }

  function linkFilename(a) {
    const dl = a.getAttribute("download");
    if (dl && dl.trim()) return dl.trim();
    try {
      const u = new URL(a.href);
      const last = u.pathname.split("/").filter(Boolean).pop();
      return last ? decodeURIComponent(last) : undefined;
    } catch {
      return undefined;
    }
  }

  document.addEventListener(
    "mouseover",
    (e) => {
      const a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
      if (!a || !isDownloadable(a)) {
        hideBtn();
        return;
      }
      hideBtn();
      btn = makeButton();
      btn.dataset.url = a.href;
      btn.dataset.filename = linkFilename(a) || "";
      document.documentElement.appendChild(btn);
      const r = a.getBoundingClientRect();
      const left = Math.min(window.scrollX + r.left, window.scrollX + window.innerWidth - 200);
      const top = window.scrollY + Math.max(r.top - 34, 0);
      btn.style.left = `${left}px`;
      btn.style.top = `${top}px`;
    },
    true,
  );

  let online = false;
  function checkOnline() {
    chrome.runtime.sendMessage({ type: "SD_HEALTH" }, (r) => {
      online = !!(r && r.ok);
    });
  }
  checkOnline();
  setInterval(checkOnline, 5000);

  document.addEventListener(
    "click",
    (e) => {
      const a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
      if (!a || !isDownloadable(a)) return;
      if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      if (!online) return;
      e.preventDefault();
      e.stopPropagation();
      hideBtn();
      chrome.runtime.sendMessage(
        {
          type: "SD_GRAB",
          url: a.href,
          filename: linkFilename(a) || undefined,
          referer: location.href,
        },
        (r) => {
          const ok = r && r.ok;
          toast(ok ? text().sent : text().fail, ok);
        },
      );
    },
    true,
  );

  document.addEventListener("scroll", hideBtn, true);
  document.addEventListener("mouseout", (e) => {
    if (e.target === document.documentElement) hideBtn();
  }, true);
})();