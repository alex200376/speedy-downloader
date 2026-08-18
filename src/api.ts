import type {
  ApiEnvelope,
  DownloadTask,
  HealthInfo,
  Settings,
} from "./types";

const STORAGE_KEY = "sd_api_base";
const DEFAULT_BASE = "http://127.0.0.1:47812";

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
    body: { filename?: string; save_dir?: string; segments?: number },
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

export function fileIcon(name: string): { label: string; color: string } {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, [string, string]> = {
    zip: ["📦", "text-amber-400 bg-amber-500/10"],
    rar: ["🗜️", "text-amber-400 bg-amber-500/10"],
    "7z": ["🗜️", "text-amber-400 bg-amber-500/10"],
    tar: ["🗜️", "text-amber-400 bg-amber-500/10"],
    gz: ["🗜️", "text-amber-400 bg-amber-500/10"],
    exe: ["🖥️", "text-sky-400 bg-sky-500/10"],
    msi: ["🖥️", "text-sky-400 bg-sky-500/10"],
    apk: ["📱", "text-emerald-400 bg-emerald-500/10"],
    iso: ["💿", "text-purple-400 bg-purple-500/10"],
    img: ["🖼️", "text-pink-400 bg-pink-500/10"],
    png: ["🖼️", "text-pink-400 bg-pink-500/10"],
    jpg: ["🖼️", "text-pink-400 bg-pink-500/10"],
    jpeg: ["🖼️", "text-pink-400 bg-pink-500/10"],
    gif: ["🖼️", "text-pink-400 bg-pink-500/10"],
    webp: ["🖼️", "text-pink-400 bg-pink-500/10"],
    svg: ["🖼️", "text-pink-400 bg-pink-500/10"],
    mp4: ["🎬", "text-violet-400 bg-violet-500/10"],
    mkv: ["🎬", "text-violet-400 bg-violet-500/10"],
    avi: ["🎬", "text-violet-400 bg-violet-500/10"],
    mov: ["🎬", "text-violet-400 bg-violet-500/10"],
    mp3: ["🎵", "text-rose-400 bg-rose-500/10"],
    flac: ["🎵", "text-rose-400 bg-rose-500/10"],
    wav: ["🎵", "text-rose-400 bg-rose-500/10"],
    pdf: ["📄", "text-red-400 bg-red-500/10"],
    doc: ["📄", "text-blue-400 bg-blue-500/10"],
    docx: ["📄", "text-blue-400 bg-blue-500/10"],
    xls: ["📊", "text-green-400 bg-green-500/10"],
    xlsx: ["📊", "text-green-400 bg-green-500/10"],
    ppt: ["📊", "text-orange-400 bg-orange-500/10"],
    txt: ["📃", "text-slate-400 bg-slate-500/10"],
    md: ["📃", "text-slate-400 bg-slate-500/10"],
  };
  const [label, color] = map[ext] ?? ["📄", "text-slate-400 bg-slate-500/10"];
  return { label, color };
}