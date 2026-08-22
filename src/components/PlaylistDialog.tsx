import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api";
import { useToastStore } from "../store/toastStore";

import type { PlaylistVideo } from "../types";
import { XIcon, PlaylistIcon, CheckIcon } from "./icons";

interface Props {
  open: boolean;
  initialUrl?: string;
  onClose: () => void;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "--:--";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function PlaylistDialog({ open, initialUrl, onClose }: Props) {
  const { t } = useTranslation();
  const toast = useToastStore((s) => s.push);
  const [url, setUrl] = useState(initialUrl ?? "");
  const [loading, setLoading] = useState(false);
  const [videos, setVideos] = useState<PlaylistVideo[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");
  const prevUrlRef = useRef("");

  // When opened with an initialUrl from extension, auto-fetch
  useEffect(() => {
    if (open && initialUrl && initialUrl !== prevUrlRef.current) {
      setUrl(initialUrl);
      prevUrlRef.current = initialUrl;
      // Auto-fetch after a short delay so state is set
      const timer = setTimeout(() => {
        if (initialUrl.trim()) {
          handleFetchWithUrl(initialUrl.trim());
        }
      }, 100);
      return () => clearTimeout(timer);
    }
    if (!open) {
      prevUrlRef.current = "";
    }
  }, [open, initialUrl]);

  const handleFetchWithUrl = async (fetchUrl: string) => {
    setLoading(true);
    setError("");
    setVideos([]);
    setSelected(new Set());
    try {
      const result = await api.fetchPlaylist(fetchUrl);
      if (result.error) {
        setError(result.error);
      } else if (result.videos && result.videos.length > 0) {
        setVideos(result.videos);
        setSelected(new Set(result.videos.map((_, i) => i)));
      } else {
        setError(t("playlist.noVideos") || "No videos found in playlist");
      }
    } catch {
      setError(t("toast.error"));
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  const handleFetch = async () => {
    if (!url.trim()) return;
    await handleFetchWithUrl(url.trim());
  };

  const toggleSelect = (index: number) => {
    const next = new Set(selected);
    if (next.has(index)) {
      next.delete(index);
    } else {
      next.add(index);
    }
    setSelected(next);
  };

  const toggleAll = () => {
    if (selected.size === videos.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(videos.map((_, i) => i)));
    }
  };

  const handleDownload = async () => {
    if (selected.size === 0) return;
    setDownloading(true);
    try {
      const items = Array.from(selected).map((i) => ({
        url: videos[i].url,
        filename: videos[i].title,
      }));
      const result = await api.createBatchTasks(items);
      if (result.error) {
        toast("error", result.error);
      } else {
        toast("success", t("playlist.added", { n: items.length }) || `${items.length} videos added`);
        onClose();
      }
    } catch {
      toast("error", t("toast.error"));
    } finally {
      setDownloading(false);
    }
  };

  const input =
    "w-full rounded-lg border border-[var(--border)] bg-[var(--bg-2)] px-3 py-2 text-[13px] text-[var(--text)] placeholder:text-[var(--muted)] outline-none focus:border-[var(--accent)]";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="mx-2 sm:mx-4 flex max-h-[85vh] w-full max-w-[min(40rem,calc(100vw-1rem))] flex-col rounded-2xl border border-[var(--border)] bg-[var(--panel)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] p-3 sm:p-4">
          <h3 className="flex items-center gap-2 text-[15px] font-semibold">
            <PlaylistIcon width={18} height={18} className="text-[var(--accent)]" />
            {t("playlist.title") || "Playlist Download"}
          </h3>
          <button onClick={onClose} className="icon-btn">
            <XIcon width={16} height={16} />
          </button>
        </div>

        {/* URL Input */}
        <div className="shrink-0 border-b border-[var(--border)] p-3 sm:p-4">
          <div className="flex gap-2">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://youtube.com/playlist?list=..."
              className={input}
              onKeyDown={(e) => e.key === "Enter" && handleFetch()}
            />
            <button onClick={handleFetch} disabled={loading} className="btn btn-primary shrink-0">
              {loading ? "…" : t("playlist.fetch") || "Fetch"}
            </button>
          </div>
          {error && (
            <div className="mt-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[12px] text-rose-400">
              {error}
            </div>
          )}
        </div>

        {/* Video List */}
        <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
          {videos.length > 0 && (
            <>
              <div className="mb-3 flex items-center justify-between">
                <span className="text-[12.5px] text-[var(--muted)]">
                  {t("playlist.found", { n: videos.length }) || `${videos.length} videos`}
                </span>
                <button onClick={toggleAll} className="text-[12px] text-[var(--accent)] hover:underline">
                  {selected.size === videos.length
                    ? t("playlist.deselectAll") || "Deselect all"
                    : t("playlist.selectAll") || "Select all"}
                </button>
              </div>
              <div className="space-y-1.5">
                {videos.map((v, i) => (
                  <div
                    key={v.id ?? i}
                    onClick={() => toggleSelect(i)}
                    className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-[13px] transition ${
                      selected.has(i)
                        ? "border-[var(--accent)]/40 bg-[var(--accent)]/5"
                        : "border-[var(--border)] hover:border-[var(--text-2)]/30"
                    }`}
                  >
                    <div
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
                        selected.has(i)
                          ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                          : "border-[var(--border)]"
                      }`}
                    >
                      {selected.has(i) && <CheckIcon width={12} height={12} />}
                    </div>
                    <span className="min-w-0 flex-1 truncate text-[var(--text)]">{v.title}</span>
                    <span className="shrink-0 text-[11px] text-[var(--muted)]">{formatDuration(v.duration)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
          {videos.length === 0 && !loading && !error && (
            <div className="py-12 text-center text-[13px] text-[var(--muted)]">
              {t("playlist.hint") || "Paste a YouTube playlist or channel URL above"}
            </div>
          )}
        </div>

        {/* Footer */}
        {videos.length > 0 && (
          <div className="flex shrink-0 items-center justify-between border-t border-[var(--border)] p-3 sm:p-4">
            <span className="text-[12.5px] text-[var(--muted)]">
              {selected.size} / {videos.length} {t("playlist.selected") || "selected"}
            </span>
            <div className="flex gap-2.5">
              <button onClick={onClose} className="btn btn-outline">
                {t("action.close")}
              </button>
              <button
                onClick={handleDownload}
                disabled={downloading || selected.size === 0}
                className="btn btn-primary"
              >
                {downloading ? "…" : t("playlist.downloadSelected") || `Download ${selected.size} videos`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
