import { create } from "zustand";

export interface ToastItem {
  id: number;
  kind: "success" | "error" | "info";
  message: string;
}

interface ToastState {
  items: ToastItem[];
  push: (kind: ToastItem["kind"], message: string) => void;
  remove: (id: number) => void;
}

let seq = 0;

export const useToastStore = create<ToastState>((set) => ({
  items: [],
  push: (kind, message) => {
    const id = ++seq;
    set((s) => ({ items: [...s.items, { id, kind, message }] }));
    setTimeout(() => {
      set((s) => ({ items: s.items.filter((t) => t.id !== id) }));
    }, 3200);
  },
  remove: (id) => set((s) => ({ items: s.items.filter((t) => t.id !== id) })),
}));