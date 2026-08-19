import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useTaskStore, useTaskStats } from "./store/taskStore";
import { useSettingsStore } from "./store/settingsStore";
import { useGrabStore } from "./store/grabStore";
import { isTauri, formatSpeed } from "./api";
import { PlusIcon, SearchIcon, CloudIcon } from "./components/icons";
import Sidebar from "./components/Sidebar";
import TaskList from "./components/TaskList";
import NewDownloadDialog from "./components/NewDownloadDialog";
import SettingsDialog from "./components/SettingsDialog";
import UpdateDialog from "./components/UpdateDialog";
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
  const [showUpdate, setShowUpdate] = useState(false);

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
        <header className="flex shrink-0 items-center gap-4 border-b border-[var(--border-soft)] bg-[var(--bg-2)]/50 px-6 py-3">
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
              className="input pl-9"
            />
          </div>

          <div className="flex-1" />

          <div className="flex items-center gap-2 text-[12px] font-medium text-[var(--text-2)]">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                connected ? "bg-emerald-400" : "bg-rose-400"
              }`}
            />
            {connected ? "Online" : "Offline"}
          </div>

          <div className="hidden text-[12px] font-semibold tabular-nums text-[var(--text-2)] md:block">
            {formatSpeed(stats.activeSpeed)}
          </div>

          <button
            onClick={() => setShowUpdate(true)}
            title={t("update.title")}
            className="icon-btn"
          >
            <CloudIcon width={17} height={17} />
          </button>

          <button onClick={() => setShowNew(true)} className="btn btn-primary">
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
      <UpdateDialog open={showUpdate} onClose={() => setShowUpdate(false)} />
      <Toasts />
    </div>
  );
}