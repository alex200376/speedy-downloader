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

function baseUrl(): string {
  return localStorage.getItem(STORAGE_KEY) || DEFAULT_BASE;
}

async function request<T>(path: string, init?: RequestInit): Promise<ApiEnvelope<T>> {
  const res = await fetch(`${baseUrl()}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
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

  async rejectTask(id: string): Promise<boolean> {
    try {
      const r = await request<null>(`/api/v1/tasks/${id}/reject`, { method: "POST" });
      return r.ok;
    } catch {
      return false;
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
): Promise<import("./types").VerifyHashResult | null> {
  if (!isTauri()) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<import("./types").VerifyHashResult>("verify_hash", { id });
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
  if (!Number.isFinite(n) || n <= 0) return "0 KB/s";
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
  };
  const [kind, color] = map[ext] ?? ["file", "text-slate-400 bg-slate-500/10"];
  return { kind, color };
}