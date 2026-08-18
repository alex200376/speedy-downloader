import { create } from "zustand";
import type { GrabRequest } from "../types";

interface GrabState {
  queue: GrabRequest[];
  current: GrabRequest | null;
  push: (g: GrabRequest) => void;
  done: () => void;
}

export const useGrabStore = create<GrabState>((set, get) => ({
  queue: [],
  current: null,
  push: (g) => {
    const { queue, current } = get();
    if (current?.id === g.id || queue.some((q) => q.id === g.id)) return;
    const newQueue = [...queue, g];
    set({ queue: newQueue, current: newQueue[0] });
  },
  done: () => {
    const queue = get().queue.slice(1);
    set({ queue, current: queue[0] ?? null });
  },
}));
