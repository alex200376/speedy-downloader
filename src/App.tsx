import { useEffect, useState, type DragEvent } from "react";
import { useTranslation } from "react-i18next";
import { useTaskStore, useTaskStats } from "./store/taskStore";
import { useSettingsStore } from "./store/settingsStore";
import { useGrabStore } from "./store/grabStore";
import { isTauri, formatSpeed } from "./api";
import { PlusIcon, SearchIcon, CloudIcon } from "./components/icons";
import Sidebar from "./components/Sidebar";
import TaskList from "./components/TaskList";
import NewDownloadDialog from "./components/NewDownloadDialog";
import PlaylistDialog from "./components/PlaylistDialog";
import SettingsDialog from "./components/SettingsDialog";
import UpdateDialog from "./components/UpdateDialog";
import WindowControls from "./components/WindowControls";
import Toasts from "./components/Toasts";

function extractDropUrl(dt: DataTransfer): string {
  for (const source of [dt.getData("text/uri-list"), dt.getData("text/plain")]) {
    const m = source.match(/https?:\/\/[^\s<>"']+/g);
    if (m && m.length) return m[0];
  }
  return "";
}

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
  const [showPlaylist, setShowPlaylist] = useState(false);
  const [playlistUrl, setPlaylistUrl] = useState("");
  const [droppedUrl, setDroppedUrl] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    const check = () => setSidebarCollapsed(window.innerWidth < 700);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    loadSettings();
    startPolling();
  }, [loadSettings, startPolling]);

  useEffect(() => {
    if (!isTauri()) return;
    let unlistenGrab: (() => void) | undefined;
    let unlistenPlaylist: (() => void) | undefined;
    let cancelled = false;
    import("@tauri-apps/api/event")
      .then(async ({ listen }) => {
        const [uGrab, uPlaylist] = await Promise.all([
          listen("grab-request", (e: { payload: import("./types").GrabRequest }) => {
            if (!cancelled) pushGrab(e.payload);
          }),
          listen("playlist-request", (e: { payload: string }) => {
            if (cancelled) return;
            setPlaylistUrl(e.payload);
            setShowPlaylist(true);
          }),
        ]);
        // If the effect was cleaned up while the dynamic import was pending,
        // unregister immediately rather than leaking the listeners.
        if (cancelled) {
          uGrab?.();
          uPlaylist?.();
          return;
        }
        unlistenGrab = uGrab;
        unlistenPlaylist = uPlaylist;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      unlistenGrab?.();
      unlistenPlaylist?.();
    };
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
    setDroppedUrl("");
    doneGrab();
  };

  const openNew = () => {
    setDroppedUrl("");
    setShowNew(true);
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.types.includes("text/uri-list") || e.dataTransfer.types.includes("text/plain")) {
      setDragOver(true);
    }
  };

  const handleDragLeave = () => setDragOver(false);

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const url = extractDropUrl(e.dataTransfer);
    if (url) {
      setDroppedUrl(url);
      setShowNew(true);
    }
  };

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Custom title bar */}
      <div className="flex shrink-0 h-8 pl-3 border-b border-[var(--border-soft)] bg-[var(--bg)]">
        <span className="flex items-center text-[11px] font-semibold text-[var(--muted)] select-none">
          <span className="hidden sm:inline">SpeedDownloader</span>
        </span>
        <div className="flex-1" data-tauri-drag-region />
        <WindowControls />
      </div>

      <div className="flex flex-1 overflow-hidden">
      <Sidebar collapsed={sidebarCollapsed} onNew={openNew} onSettings={() => setShowSettings(true)} onPlaylist={() => setShowPlaylist(true)} />

      <main className="relative flex flex-1 flex-col overflow-hidden">
          {dragOver && (
            <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-[var(--bg)]/70">
              <div className="animate-pop rounded-lg border border-dashed border-[var(--accent)] bg-[var(--panel)] px-6 py-4 text-[14px] font-semibold text-[var(--accent)]">
                {t("drop.hint")}
              </div>
            </div>
          )}
          <header className="flex shrink-0 items-center justify-between gap-2.5 border-b border-[var(--border-soft)] bg-[var(--bg-2)]/50 px-3 py-2.5 sm:gap-4 sm:px-5 sm:py-3">
          <div className="relative min-w-0 flex-1 max-w-72">
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

          <div className="flex items-center gap-2 text-[12px] font-medium text-[var(--text-2)]">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                connected ? "bg-emerald-400" : "bg-rose-400"
              }`}
            />
            <span className="hidden sm:inline">{connected ? "Online" : "Offline"}</span>
          </div>

          <div className="ml-auto hidden text-[12px] font-semibold tabular-nums text-[var(--text-2)] lg:block">
            {formatSpeed(stats.activeSpeed)}
          </div>

          <button
            onClick={() => setShowUpdate(true)}
            title={t("update.title")}
            className="icon-btn shrink-0"
          >
            <CloudIcon width={17} height={17} />
          </button>

          <button onClick={openNew} className="btn btn-primary shrink-0">
            <PlusIcon width={15} height={15} />
            <span className="hidden sm:inline">{t("header.newDownload")}</span>
          </button>
        </header>

        <TaskList onNew={openNew} />
      </main>
      </div>

      <NewDownloadDialog
        open={showNew || !!grab}
        initialUrl={droppedUrl}
        grab={grab}
        onClose={closeNew}
      />
      <PlaylistDialog open={showPlaylist} initialUrl={playlistUrl} onClose={() => { setShowPlaylist(false); setPlaylistUrl(""); }} />
      <SettingsDialog open={showSettings} onClose={() => setShowSettings(false)} />
      <UpdateDialog open={showUpdate} onClose={() => setShowUpdate(false)} />
      <Toasts />
    </div>
  );
}