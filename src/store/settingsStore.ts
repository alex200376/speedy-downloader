import { create } from "zustand";
import { api } from "../api";
import type { Settings } from "../types";
import { setAppLanguage } from "../i18n";

interface SettingsState {
  settings: Settings | null;
  loaded: boolean;
  load: () => Promise<void>;
  save: (s: Settings) => Promise<boolean>;
  apply: () => void;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: null,
  loaded: false,

  load: async () => {
    const s = await api.getSettings();
    if (s) {
      set({ settings: s, loaded: true });
      get().apply();
    } else {
      set({ loaded: true });
    }
  },

  apply: () => {
    const s = get().settings;
    if (!s) return;
    const theme = s.theme;
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const resolved = theme === "system" ? (prefersDark ? "dark" : "light") : theme;
    document.documentElement.dataset.theme = resolved;
    document.documentElement.dataset.accent = s.accent || "zinc";
    setAppLanguage(s.language);
  },

  save: async (s: Settings) => {
    const updated = await api.updateSettings(s);
    if (updated) {
      set({ settings: updated });
      get().apply();
      return true;
    }
    return false;
  },
}));