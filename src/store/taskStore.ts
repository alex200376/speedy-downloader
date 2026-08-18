import { create } from "zustand";
import { api } from "../api";
import type { DownloadTask, FilterKey } from "../types";

interface TaskState {
  tasks: DownloadTask[];
  filter: FilterKey;
  search: string;
  connected: boolean;
  refresh: () => Promise<void>;
  startPolling: () => void;
  setFilter: (f: FilterKey) => void;
  setSearch: (s: string) => void;
  pauseTask: (id: string) => Promise<boolean>;
  resumeTask: (id: string) => Promise<boolean>;
  cancelTask: (id: string) => Promise<boolean>;
  removeTask: (id: string) => Promise<boolean>;
}

let timer: ReturnType<typeof setInterval> | null = null;

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: [],
  filter: "all",
  search: "",
  connected: false,

  refresh: async () => {
    const [tasks, health] = await Promise.all([api.listTasks(), api.health()]);
    set({ tasks, connected: health !== null });
  },

  startPolling: () => {
    if (timer) return;
    get().refresh();
    timer = setInterval(() => get().refresh(), 600);
  },

  setFilter: (f) => set({ filter: f }),
  setSearch: (s) => set({ search: s }),

  pauseTask: async (id) => {
    const ok = await api.pause(id);
    if (ok) get().refresh();
    return ok;
  },

  resumeTask: async (id) => {
    const ok = await api.resume(id);
    if (ok) get().refresh();
    return ok;
  },

  cancelTask: async (id) => {
    const ok = await api.cancel(id);
    if (ok) get().refresh();
    return ok;
  },

  removeTask: async (id) => {
    const ok = await api.remove(id);
    if (ok) get().refresh();
    return ok;
  },
}));

export function useFilteredTasks() {
  const { tasks, filter, search } = useTaskStore();
  return tasks.filter((t) => {
    if (filter === "downloading" && t.status !== "Downloading" && t.status !== "Queued") return false;
    if (filter === "completed" && t.status !== "Completed") return false;
    if (filter === "paused" && t.status !== "Paused") return false;
    if (filter === "error" && t.status !== "Error") return false;
    if (search && !t.filename.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });
}

export function useTaskStats() {
  const { tasks } = useTaskStore();
  return {
    all: tasks.length,
    downloading: tasks.filter((t) => t.status === "Downloading" || t.status === "Queued").length,
    completed: tasks.filter((t) => t.status === "Completed").length,
    paused: tasks.filter((t) => t.status === "Paused").length,
    error: tasks.filter((t) => t.status === "Error").length,
    activeSpeed: tasks
      .filter((t) => t.status === "Downloading")
      .reduce((acc, t) => acc + t.speed, 0),
  };
}