import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useTaskStore, useTaskStats } from "./store/taskStore";
import { useSettingsStore } from "./store/settingsStore";
import { useGrabStore } from "./store/grabStore";
import { isTauri, formatSpeed } from "./api";
import { PlusIcon, SearchIcon } from "./components/icons";
import Sidebar from "./components/Sidebar";
import TaskList from "./components/TaskList";
import NewDownloadDialog from "./components/NewDownloadDialog";
import SettingsDialog from "./components/SettingsDialog";
import Toasts from "./components/Toasts";

export default function App() {
  const { t } = useTranslation();
  const { connected, search, setSearch, tasks } = useTaskStore();
  const stats = useTaskStats();
  const loadSettings = useSettingsStore((s) => s.load);
  const startPolling = useTaskStore((s) => s.startPolling);
  const { current: grab, push: pushGrab, done: doneGrab } = useGrabStore();

  const [showNew, setShowNew] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    loadSettings();
    startPolling();
  }, [loadSettings, startPolling]);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen("grab-request", (e: { payload: import("./types").GrabRequest }) => {
          pushGrab(e.payload);
        }),
      )
      .then((fn) => {
        unlisten = fn;
      });
    return () => unlisten?.();
  }, [pushGrab]);

  useEffect(() => {
    const pending = tasks.filter((t) => t.status === "Pending");
    for (const t of pending) {
      pushGrab({
        id: t.id,
        url: t.url,
        filename: t.filename,
        save_dir: t.save_dir,
        referer: t.referer,
      });
    }
  }, [tasks, pushGrab]);

  const closeNew = () => {
    setShowNew(false);
    doneGrab();
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <Sidebar onNew={() => setShowNew(true)} onSettings={() => setShowSettings(true)} />

      <main className="relative flex flex-1 flex-col overflow-hidden">
        <header className="flex shrink-0 items-center gap-4 border-b border-[var(--border-soft)] bg-[var(--bg-2)]/40 px-6 py-3.5">
          <div className="relative w-72">
            <SearchIcon
              width={15}
              height={15}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]"
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("header.search")}
              className="w-full rounded-xl border border-[var(--border-soft)] bg-[var(--panel)] py-2 pl-9 pr-3 text-[13px] outline-none transition placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20"
            />
          </div>

          <div className="flex-1" />

          <div className="flex items-center gap-1.5 rounded-xl border border-[var(--border-soft)] bg-[var(--panel)] px-3 py-1.5">
            <span
              className={`h-2 w-2 rounded-full ${
                connected ? "bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.8)]" : "bg-rose-400"
              }`}
            />
            <span className="text-[12px] font-medium text-[var(--text-2)]">
              {connected ? "Online" : "Offline"}
            </span>
          </div>

          <div className="hidden items-center gap-1.5 rounded-xl border border-[var(--border-soft)] bg-[var(--panel)] px-3 py-1.5 text-[12px] font-semibold tabular-nums text-[var(--accent)] md:flex">
            {formatSpeed(stats.activeSpeed)}
          </div>

          <button
            onClick={() => setShowNew(true)}
            className="app-gradient flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-semibold text-white shadow-lg shadow-indigo-500/25 transition hover:brightness-110 active:scale-95"
          >
            <PlusIcon width={15} height={15} />
            {t("header.newDownload")}
          </button>
        </header>

        <TaskList onNew={() => setShowNew(true)} />
      </main>

      <NewDownloadDialog
        open={showNew || !!grab}
        grab={grab}
        onClose={closeNew}
      />
      <SettingsDialog open={showSettings} onClose={() => setShowSettings(false)} />
      <Toasts />
    </div>
  );
}