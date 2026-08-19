import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, chooseFolder } from "../api";
import { useSettingsStore } from "../store/settingsStore";
import { useToastStore } from "../store/toastStore";
import type { GrabRequest } from "../types";
import { XIcon, FolderIcon, ZapIcon } from "./icons";

interface Props {
  open: boolean;
  initialUrl?: string;
  grab?: GrabRequest | null;
  onClose: () => void;
}

export default function NewDownloadDialog({ open, initialUrl, grab, onClose }: Props) {
  const { t } = useTranslation();
  const settings = useSettingsStore((s) => s.settings);
  const toast = useToastStore((s) => s.push);

  const [url, setUrl] = useState("");
  const [filename, setFilename] = useState("");
  const [saveDir, setSaveDir] = useState("");
  const [segments, setSegments] = useState(8);
  const [referer, setReferer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const isGrab = !!grab;

  useEffect(() => {
    if (open) {
      setUrl(grab?.url ?? initialUrl ?? "");
      setFilename(grab?.filename ?? "");
      setSaveDir(grab?.save_dir ?? settings?.save_dir ?? "");
      setSegments(settings?.default_segments ?? 8);
      setReferer(grab?.referer ?? "");
      setError("");
    }
  }, [open, initialUrl, grab, settings]);

  if (!open) return null;

  const autoFilename = () => {
    try {
      const u = new URL(url);
      const last = u.pathname.split("/").filter(Boolean).pop();
      return last ? decodeURIComponent(last) : "";
    } catch {
      return "";
    }
  };

  const handleBrowse = async () => {
    const dir = await chooseFolder();
    if (dir) setSaveDir(dir);
    else if (!dir && !("__TAURI_INTERNALS__" in window)) toast("error", t("toast.error"));
  };

  const handleReject = async () => {
    if (grab) {
      setBusy(true);
      await api.rejectTask(grab.id);
      setBusy(false);
    }
    onClose();
  };

  const submit = async () => {
    if (!/^https?:\/\//i.test(url.trim())) {
      setError(t("dialog.invalidUrl"));
      return;
    }
    setBusy(true);
    if (grab) {
      const { task, error: err } = await api.confirmTask(grab.id, {
        filename: filename.trim() || undefined,
        save_dir: saveDir.trim() || undefined,
        segments,
      });
      setBusy(false);
      if (task) {
        toast("success", t("dialog.added"));
        onClose();
      } else {
        setError(err ?? t("toast.error"));
      }
      return;
    }
    const { task, error: err } = await api.createTask({
      url: url.trim(),
      filename: filename.trim() || undefined,
      save_dir: saveDir.trim() || undefined,
      segments,
      referer: referer.trim() || undefined,
    });
    setBusy(false);
    if (task) {
      toast("success", t("dialog.added"));
      onClose();
    } else {
      setError(err ?? t("toast.error"));
    }
  };

  const input = "input";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => e.target === e.currentTarget && (isGrab ? handleReject() : onClose())}
    >
      <div className="animate-pop w-full max-w-lg rounded-lg border border-[var(--border)] bg-[var(--panel)] p-6 shadow-[var(--shadow)]">
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--panel-2)] text-[var(--text)]">
              <ZapIcon width={17} height={17} />
            </div>
            <h2 className="text-[16px] font-bold">
              {isGrab ? t("dialog.grabTitle") : t("dialog.title")}
            </h2>
          </div>
          <button
            onClick={isGrab ? handleReject : onClose}
            disabled={busy}
            className="icon-btn disabled:opacity-50"
          >
            <XIcon width={16} height={16} />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-[12.5px] font-semibold text-[var(--text-2)]">
              {t("dialog.url")}
            </label>
            <textarea
              value={url}
              readOnly={isGrab}
              onChange={(e) => {
                setUrl(e.target.value);
                setError("");
                if (!filename) setFilename(autoFilename());
              }}
              onBlur={() => !filename && setFilename(autoFilename())}
              placeholder={t("dialog.urlPlaceholder")}
              rows={2}
              className={`${input} resize-none font-mono text-[12.5px] ${isGrab ? "opacity-70" : ""}`}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-[12.5px] font-semibold text-[var(--text-2)]">
                {t("dialog.filename")}
              </label>
              <input
                value={filename}
                onChange={(e) => setFilename(e.target.value)}
                placeholder={t("dialog.filenameHint")}
                className={input}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[12.5px] font-semibold text-[var(--text-2)]">
                {t("dialog.segments")}
              </label>
              <select
                value={segments}
                onChange={(e) => setSegments(Number(e.target.value))}
                className={`${input} cursor-pointer`}
              >
                {[1, 2, 4, 8, 16, 32].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-[12.5px] font-semibold text-[var(--text-2)]">
              {t("dialog.saveTo")}
            </label>
            <div className="flex gap-2">
              <input value={saveDir} onChange={(e) => setSaveDir(e.target.value)} className={input} />
              <button
                onClick={handleBrowse}
                className="btn btn-outline shrink-0"
              >
                <FolderIcon width={15} height={15} />
                {t("action.browse")}
              </button>
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-[12.5px] font-semibold text-[var(--text-2)]">
              {t("dialog.referer")}
            </label>
            <input
              value={referer}
              onChange={(e) => setReferer(e.target.value)}
              placeholder="https://…"
              className={`${input} font-mono text-[12.5px]`}
            />
          </div>

          {error && (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-[12.5px] text-rose-400">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2.5 pt-2">
            <button
              onClick={isGrab ? handleReject : onClose}
              disabled={busy}
              className="btn btn-outline disabled:opacity-50"
            >
              {isGrab ? t("action.cancel") : t("action.close")}
            </button>
            <button
              onClick={submit}
              disabled={busy}
              className="btn btn-primary"
            >
              <ZapIcon width={15} height={15} />
              {busy ? "…" : isGrab ? t("action.download") : t("action.start")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}