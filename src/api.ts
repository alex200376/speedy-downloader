import type {
  ApiEnvelope,
  DownloadTask,
  HealthInfo,
  Settings,
} from "./types";

const STORAGE_KEY = "sd_api_base";
const DEFAULT_BASE = "http://127.0.0.1:47812";

export const EXTENSION_DOWNLOAD_URL =
  "https://github.com/alex200376/speedy-downloader/releases/latest/download/SpeedDownloader-extension.zip";

const TOKEN_KEY = "sd_api_token";

let cachedToken: string | null = null;

/**
 * Obtain the per-install local API auth token. In Tauri it is fetched from the
 * backend once and cached; otherwise (browser dev / pasted token) it is read
 * from localStorage. `isTauri` is a hoisted function declaration below.
 */
export async function getApiToken(): Promise<string> {
  if (cachedToken) return cachedToken;
  const stored = localStorage.getItem(TOKEN_KEY);
  if (stored) {
    cachedToken = stored;
    return stored;
  }
  if (isTauri()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const t = await invoke<string>("get_api_token");
      if (t) {
        localStorage.setItem(TOKEN_KEY, t);
        cachedToken = t;
        return t;
      }
    } catch {
      /* ignore */
    }
  }
  return "";
}

export function clearApiToken() {
  cachedToken = null;
  localStorage.removeItem(TOKEN_KEY);
}

function baseUrl(): string {
  return localStorage.getItem(STORAGE_KEY) || DEFAULT_BASE;
}

async function request<T>(path: string, init?: RequestInit): Promise<ApiEnvelope<T>> {
  const token = await getApiToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((init?.headers as Record<string, string> | undefined) ?? {}),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers,
  });
  if (!res.ok) {
    return { ok: false, data: null, error: `HTTP ${res.status}` };
  }
  return (await res.json()) as ApiEnvelope<T>;
}

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export const api = {
  async health(): Promise<HealthInfo | null> {
    try {
      const r = await request<HealthInfo>("/api/v1/health");
      return r.ok ? r.data : null;
    } catch {
      return null;
    }
  },

  async listTasks(): Promise<DownloadTask[]> {
    try {
      const r = await request<DownloadTask[]>("/api/v1/tasks");
      return r.ok && r.data ? r.data : [];
    } catch {
      return [];
    }
  },

  async createTask(input: {
    url: string;
    filename?: string;
    save_dir?: string;
    segments?: number;
    referer?: string;
    headers?: Record<string, string>;
    kind?: "http" | "video";
    quality?: string;
    write_subs?: boolean;
    sub_lang?: string;
  }): Promise<{ task?: DownloadTask; error?: string }> {
    try {
      const r = await request<DownloadTask>("/api/v1/tasks", {
        method: "POST",
        body: JSON.stringify(input),
      });
      return r.ok ? { task: r.data ?? undefined } : { error: r.error ?? "error" };
    } catch (e) {
      return { error: String(e) };
    }
  },

  async pause(id: string): Promise<boolean> {
    try {
      const r = await request<null>(`/api/v1/tasks/${id}/pause`, { method: "POST" });
      return r.ok;
    } catch {
      return false;
    }
  },

  async resume(id: string): Promise<boolean> {
    try {
      const r = await request<null>(`/api/v1/tasks/${id}/resume`, { method: "POST" });
      return r.ok;
    } catch {
      return false;
    }
  },

  async cancel(id: string): Promise<boolean> {
    try {
      const r = await request<null>(`/api/v1/tasks/${id}/cancel`, { method: "POST" });
      return r.ok;
    } catch {
      return false;
    }
  },

  async confirmTask(
    id: string,
    body: {
      filename?: string;
      save_dir?: string;
      segments?: number;
      headers?: Record<string, string>;
      quality?: string;
      write_subs?: boolean;
      sub_lang?: string;
    },
  ): Promise<{ task?: DownloadTask; error?: string }> {
    try {
      const r = await request<DownloadTask>(`/api/v1/tasks/${id}/confirm`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      return r.ok ? { task: r.data ?? undefined } : { error: r.error ?? "error" };
    } catch (e) {
      return { error: String(e) };
    }
  },

  async fetchPlaylist(url: string): Promise<{ videos?: import("./types").PlaylistVideo[]; error?: string }> {
    try {
      const r = await request<import("./types").PlaylistVideo[]>("/api/v1/playlist", {
        method: "POST",
        body: JSON.stringify({ url }),
      });
      return r.ok ? { videos: r.data ?? [] } : { error: r.error ?? "error" };
    } catch (e) {
      return { error: String(e) };
    }
  },

  async createBatchTasks(
    items: { url: string; filename?: string }[],
  ): Promise<{ tasks?: DownloadTask[]; error?: string }> {
    try {
      const r = await request<DownloadTask[]>("/api/v1/tasks/batch", {
        method: "POST",
        body: JSON.stringify({ items }),
      });
      return r.ok ? { tasks: r.data ?? [] } : { error: r.error ?? "error" };
    } catch (e) {
      return { error: String(e) };
    }
  },

  async rejectTask(id: string): Promise<boolean> {
    try {
      const r = await request<null>(`/api/v1/tasks/${id}/reject`, { method: "POST" });
      return r.ok;
    } catch {
      return false;
    }
  },

  async listSubtitles(url: string): Promise<{ subtitles?: { code: string; name: string; auto: boolean }[]; error?: string }> {
    try {
      const r = await request<{ code: string; name: string; auto: boolean }[]>("/api/v1/subtitles", {
        method: "POST",
        body: JSON.stringify({ url }),
      });
      return r.ok ? { subtitles: r.data ?? [] } : { error: r.error ?? "error" };
    } catch (e) {
      return { error: String(e) };
    }
  },

  async remove(id: string): Promise<boolean> {
    try {
      const r = await request<null>(`/api/v1/tasks/${id}`, { method: "DELETE" });
      return r.ok;
    } catch {
      return false;
    }
  },

  async getSettings(): Promise<Settings | null> {
    try {
      const r = await request<Settings>("/api/v1/settings");
      return r.ok ? r.data : null;
    } catch {
      return null;
    }
  },

  async updateSettings(s: Settings): Promise<Settings | null> {
    try {
      const r = await request<Settings>("/api/v1/settings", {
        method: "PUT",
        body: JSON.stringify(s),
      });
      return r.ok ? r.data : null;
    } catch {
      return null;
    }
  },
};

export async function verifyHash(
  id: string,
  algorithm?: string,
  expectedHash?: string,
): Promise<import("./types").VerifyHashResult | null> {
  if (!isTauri()) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<import("./types").VerifyHashResult>("verify_hash", {
      id,
      algorithm: algorithm ?? null,
      expectedHash: expectedHash ?? null,
    });
  } catch {
    return null;
  }
}

export async function chooseFolder(): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const p = await invoke<string | null>("choose_folder");
    return p;
  } catch {
    return null;
  }
}

export async function openFolder(path: string): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("open_folder", { path });
    return true;
  } catch {
    return false;
  }
}

export interface ExtensionInfo {
  path: string;
  chrome: boolean;
  edge: boolean;
}

export async function prepareExtension(): Promise<ExtensionInfo | null> {
  if (!isTauri()) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<ExtensionInfo>("prepare_extension");
  } catch {
    return null;
  }
}

export async function openExtensionsPage(
  browser?: "chrome" | "edge" | "auto",
): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<string>("open_extensions_page", { browser });
  } catch {
    return null;
  }
}

export async function checkUpdate(): Promise<import("./types").UpdateInfo | null> {
  if (!isTauri()) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<import("./types").UpdateInfo>("check_update");
  } catch {
    return null;
  }
}

export async function openUrl(url: string): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("open_url", { url });
    return true;
  } catch {
    return false;
  }
}

export interface VideoToolsStatus {
  installed: boolean;
  ytdlp_version: string | null;
  ffmpeg_version: string | null;
  path: string;
}

export async function getVideoToolsStatus(): Promise<VideoToolsStatus | null> {
  if (!isTauri()) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<VideoToolsStatus>("get_video_tools_status");
  } catch {
    return null;
  }
}

export async function installVideoTools(): Promise<VideoToolsStatus | null> {
  if (!isTauri()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<VideoToolsStatus>("install_video_tools");
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

export function formatSpeed(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n <= 0) return "0 KB/s";
  return `${formatBytes(n)}/s`;
}

export function formatEta(remaining: number, speed: number): string {
  if (!Number.isFinite(remaining) || remaining <= 0 || !Number.isFinite(speed) || speed <= 0) {
    return "—";
  }
  const secs = remaining / speed;
  if (secs < 60) return `${Math.ceil(secs)}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${Math.ceil(secs % 60)}s`;
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
}

export function fileIcon(name: string): { kind: string; color: string } {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, [string, string]> = {
    zip: ["package", "text-amber-400 bg-amber-500/10"],
    rar: ["package", "text-amber-400 bg-amber-500/10"],
    "7z": ["package", "text-amber-400 bg-amber-500/10"],
    tar: ["package", "text-amber-400 bg-amber-500/10"],
    gz: ["package", "text-amber-400 bg-amber-500/10"],
    exe: ["app", "text-sky-400 bg-sky-500/10"],
    msi: ["app", "text-sky-400 bg-sky-500/10"],
    apk: ["apk", "text-emerald-400 bg-emerald-500/10"],
    iso: ["package", "text-violet-400 bg-violet-500/10"],
    img: ["image", "text-pink-400 bg-pink-500/10"],
    png: ["image", "text-pink-400 bg-pink-500/10"],
    jpg: ["image", "text-pink-400 bg-pink-500/10"],
    jpeg: ["image", "text-pink-400 bg-pink-500/10"],
    gif: ["image", "text-pink-400 bg-pink-500/10"],
    webp: ["image", "text-pink-400 bg-pink-500/10"],
    svg: ["image", "text-pink-400 bg-pink-500/10"],
    mp4: ["video", "text-violet-400 bg-violet-500/10"],
    mkv: ["video", "text-violet-400 bg-violet-500/10"],
    avi: ["video", "text-violet-400 bg-violet-500/10"],
    mov: ["video", "text-violet-400 bg-violet-500/10"],
    mp3: ["music", "text-pink-400 bg-pink-500/10"],
    flac: ["music", "text-pink-400 bg-pink-500/10"],
    wav: ["music", "text-pink-400 bg-pink-500/10"],
    pdf: ["fileText", "text-red-400 bg-red-500/10"],
    doc: ["fileText", "text-blue-400 bg-blue-500/10"],
    docx: ["fileText", "text-blue-400 bg-blue-500/10"],
    xls: ["sheet", "text-emerald-400 bg-emerald-500/10"],
    xlsx: ["sheet", "text-emerald-400 bg-emerald-500/10"],
    ppt: ["sheet", "text-orange-400 bg-orange-500/10"],
    pptx: ["sheet", "text-orange-400 bg-orange-500/10"],
    txt: ["fileText", "text-slate-400 bg-slate-500/10"],
    md: ["fileText", "text-slate-400 bg-slate-500/10"],
    torrent: ["package", "text-orange-400 bg-orange-500/10"],
  };
  const [kind, color] = map[ext] ?? ["file", "text-slate-400 bg-slate-500/10"];
  return { kind, color };
}

/**
 * Map known backend error messages to stable i18n keys so the UI can show
 * localized text regardless of the language the backend message was written in.
 * Unknown messages return null and the caller falls back to the raw string.
 */
export function backendErrorKey(raw: string | null | undefined): string | null {
  const r = raw || "";
  if (r.includes("403") || r.includes("被 Cloudflare")) return "error.forbidden";
  if (r.includes("404")) return "error.notFound";
  if (r.includes("URL 必须是 http(s)") || r.includes("仅支持 http(s)")) return "error.invalidUrl";
  if (r.includes("连接停滞无数据") || r.includes("stalled") || r.includes("timeout")) return "error.stalled";
  if (r === "cancelled" || r.includes("已取消")) return "error.cancelled";
  if (r.includes("任务不存在")) return "error.taskMissing";
  return null;
}