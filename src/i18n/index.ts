import i18n from "i18next";
import { initReactI18next } from "react-i18next";

const resources = {
  en: {
    translation: {
      appName: "SpeedDownloader",
      nav: {
        all: "All",
        downloading: "Active",
        completed: "Completed",
        paused: "Paused",
        error: "Failed",
      },
      header: {
        newDownload: "New Download",
        search: "Search downloads…",
      },
      action: {
        pause: "Pause",
        resume: "Resume",
        cancel: "Cancel",
        remove: "Remove",
        openFolder: "Open folder",
        retry: "Retry",
        start: "Start Download",
        download: "Download",
        browse: "Browse",
        copy: "Copy",
        close: "Close",
        save: "Save",
      },
      status: {
        Pending: "Confirming",
        Queued: "Queued",
        Downloading: "Downloading",
        Paused: "Paused",
        Completed: "Completed",
        Error: "Error",
        Canceled: "Canceled",
      },
      task: {
        segments: "{{n}} connections",
        unknownSize: "Unknown size",
        error: "Error",
      },
      dialog: {
        title: "New Download",
        grabTitle: "Confirm Download",
        url: "Download URL",
        urlPlaceholder: "https://example.com/file.zip",
        filename: "File name",
        filenameHint: "Auto-detect from server",
        saveTo: "Save to",
        segments: "Connections",
        referer: "Referer (optional)",
        invalidUrl: "Please enter a valid http(s) URL",
        added: "Download task added",
      },
      settings: {
        title: "Settings",
        saveDir: "Download folder",
        maxConcurrent: "Max concurrent downloads",
        defaultSegments: "Default connections per file",
        speedLimit: "Speed limit",
        speedLimitKbps: "KB/s (0 = unlimited)",
        language: "Language",
        theme: "Theme",
        themeDark: "Dark",
        themeLight: "Light",
        extension: "Chrome Extension",
        extensionDesc:
          "Install the extension to grab downloads directly from your browser.",
        extensionSteps:
          "1. Open chrome://extensions · 2. Enable Developer mode · 3. Load unpacked → select the chrome-extension folder of this project",
        extensionInstall: "Install extension",
        extensionInstalled:
          "Extension folder is ready and copied to clipboard. Click “Load unpacked” in the browser page and paste.",
        extensionFail: "Failed to prepare extension",
        extensionOpenFail: "Failed to open the extensions page (Chrome/Edge not found)",
        extensionNoBrowser: "not detected",
        extensionBrowsers: "Detected browsers:",
        openExtensionsPage: "Open extensions page",
        extensionPath: "Extension folder",
        saved: "Settings saved",
      },
      theme: {
        dark: "Dark",
        light: "Light",
        system: "System",
      },
      empty: {
        title: "No downloads yet",
        hint: "Click “New Download” or use the Chrome extension to grab files from the web.",
      },
      toast: {
        paused: "Download paused",
        resumed: "Download resumed",
        canceled: "Download canceled",
        removed: "Task removed",
        error: "Operation failed",
        saved: "Settings saved",
      },
      title: {
        speed: "Speed",
        downloaded: "Downloaded",
        size: "Size",
        eta: "ETA",
      },
    },
  },
  zh: {
    translation: {
      appName: "极速下载器",
      nav: {
        all: "全部任务",
        downloading: "进行中",
        completed: "已完成",
        paused: "已暂停",
        error: "失败",
      },
      header: {
        newDownload: "新建下载",
        search: "搜索下载任务…",
      },
      action: {
        pause: "暂停",
        resume: "继续",
        cancel: "取消",
        remove: "删除",
        openFolder: "打开文件夹",
        retry: "重试",
        start: "开始下载",
        download: "下载",
        browse: "浏览",
        copy: "复制",
        close: "关闭",
        save: "保存",
      },
      status: {
        Pending: "待确认",
        Queued: "排队中",
        Downloading: "下载中",
        Paused: "已暂停",
        Completed: "已完成",
        Error: "出错",
        Canceled: "已取消",
      },
      task: {
        segments: "{{n}} 个连接",
        unknownSize: "未知大小",
        error: "错误",
      },
      dialog: {
        title: "新建下载",
        grabTitle: "确认下载",
        url: "下载地址",
        urlPlaceholder: "https://example.com/file.zip",
        filename: "文件名",
        filenameHint: "自动从服务器识别",
        saveTo: "保存位置",
        segments: "连接数",
        referer: "来源页面 (可选)",
        invalidUrl: "请输入有效的 http(s) 链接",
        added: "已添加下载任务",
      },
      settings: {
        title: "设置",
        saveDir: "下载目录",
        maxConcurrent: "最大并发下载数",
        defaultSegments: "每个文件的默认连接数",
        speedLimit: "速度限制",
        speedLimitKbps: "KB/s（0 为不限速）",
        language: "语言",
        theme: "主题",
        themeDark: "深色",
        themeLight: "浅色",
        extension: "Chrome 扩展",
        extensionDesc: "安装扩展后，可直接在浏览器中一键抓取下载。",
        extensionSteps:
          "1. 打开 chrome://extensions · 2. 开启开发者模式 · 3. 加载已解压的扩展程序 → 选择本项目的 chrome-extension 文件夹",
        extensionInstall: "一键安装扩展",
        extensionInstalled:
          "扩展已就绪，路径已复制到剪贴板。在浏览器扩展页点击「加载已解压的扩展程序」并粘贴即可。",
        extensionFail: "扩展安装失败",
        extensionOpenFail: "无法打开扩展页（未检测到 Chrome/Edge）",
        extensionNoBrowser: "未检测到",
        extensionBrowsers: "已检测浏览器：",
        openExtensionsPage: "打开浏览器扩展页",
        extensionPath: "扩展目录",
        saved: "设置已保存",
      },
      theme: {
        dark: "深色",
        light: "浅色",
        system: "跟随系统",
      },
      empty: {
        title: "暂无下载任务",
        hint: "点击「新建下载」或使用 Chrome 扩展从网页抓取文件。",
      },
      toast: {
        paused: "下载已暂停",
        resumed: "下载已继续",
        canceled: "下载已取消",
        removed: "任务已删除",
        error: "操作失败",
        saved: "设置已保存",
      },
      title: {
        speed: "速度",
        downloaded: "已下载",
        size: "大小",
        eta: "剩余时间",
      },
    },
  },
};

i18n.use(initReactI18next).init({
  resources,
  lng: "zh",
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

export function setAppLanguage(lang: string) {
  if (lang === "en" || lang === "zh") {
    i18n.changeLanguage(lang);
  }
}

export default i18n;