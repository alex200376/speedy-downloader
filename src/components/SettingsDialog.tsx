import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { chooseFolder, openExtensionsPage, prepareExtension } from "../api";
import { useSettingsStore } from "../store/settingsStore";
import { useToastStore } from "../store/toastStore";
import type { Settings } from "../types";
import { XIcon, FolderIcon, CopyIcon, CheckIcon, DownloadIcon } from "./icons";

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function SettingsDialog({ open, onClose }: Props) {
  const { t } = useTranslation();
  const { settings, save } = useSettingsStore();
  const toast = useToastStore((s) => s.push);
  const [copied, setCopied] = useState(false);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [extBusy, setExtBusy] = useState(false);
  const [extPath, setExtPath] = useState("");
  const [browsers, setBrowsers] = useState<{ chrome: boolean; edge: boolean } | null>(null);

  useEffect(() => {
    if (open && settings) setDraft(settings);
  }, [open, settings]);

  useEffect(() => {
    if (!open) return;
    setExtBusy(true);
    prepareExtension()
      .then((info) => {
        if (info) {
          setExtPath(info.path);
          setBrowsers({ chrome: info.chrome, edge: info.edge });
        }
      })
      .finally(() => setExtBusy(false));
  }, [open]);

  if (!open || !settings || !draft) return null;

  const set = (patch: Partial<Settings>) =>
    setDraft((d) => (d ? { ...d, ...patch } : d));

  const saveAll = async () => {
    if (!draft) return;
    const ok = await save({ ...draft, speed_limit_kbps: Number(draft.speed_limit_kbps) || 0 });
    if (ok) toast("success", t("toast.saved"));
  };

  const browseDir = async () => {
    const dir = await chooseFolder();
    if (dir) set({ save_dir: dir });
  };

  const copySteps = async () => {
    const text = t("settings.extensionSteps");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* noop */
    }
  };

  const installExtension = async () => {
    setExtBusy(true);
    const info = await prepareExtension();
    setExtBusy(false);
    if (!info) {
      toast("error", t("settings.extensionFail"));
      return;
    }
    setExtPath(info.path);
    setBrowsers({ chrome: info.chrome, edge: info.edge });
    try {
      await navigator.clipboard.writeText(info.path);
    } catch {
      /* noop */
    }
    const opened = await openExtensionsPage("auto");
    if (!opened) {
      toast("error", t("settings.extensionOpenFail"));
      return;
    }
    toast("success", t("settings.extensionInstalled"));
  };

  const field =
    "w-full rounded-xl border border-[var(--border)] bg-[var(--bg-2)] px-3.5 py-2.5 text-[13.5px] outline-none transition focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20";
  const label = "mb-1.5 block text-[12.5px] font-semibold text-[var(--text-2)]";
  const grid2 = "grid grid-cols-2 gap-3";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="animate-pop w-full max-w-xl rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-6 shadow-2xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-[16px] font-bold">{t("settings.title")}</h2>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--muted)] transition hover:bg-[var(--panel-2)] hover:text-[var(--text)]"
          >
            <XIcon width={16} height={16} />
          </button>
        </div>

        <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
          <div>
            <label className={label}>{t("settings.saveDir")}</label>
            <div className="flex gap-2">
              <input value={draft.save_dir} onChange={(e) => set({ save_dir: e.target.value })} className={field} />
              <button
                onClick={browseDir}
                className="flex shrink-0 items-center gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--panel-2)] px-3.5 text-[13px] font-semibold text-[var(--text-2)] transition hover:border-[var(--accent)]/40 hover:text-[var(--accent)]"
              >
                <FolderIcon width={15} height={15} />
                {t("action.browse")}
              </button>
            </div>
          </div>

          <div className={grid2}>
            <div>
              <label className={label}>{t("settings.maxConcurrent")}</label>
              <input
                type="number"
                min={1}
                max={8}
                value={draft.max_concurrent}
                onChange={(e) => set({ max_concurrent: Number(e.target.value) || 1 })}
                className={field}
              />
            </div>
            <div>
              <label className={label}>{t("settings.defaultSegments")}</label>
              <select
                value={draft.default_segments}
                onChange={(e) => set({ default_segments: Number(e.target.value) })}
                className={`${field} cursor-pointer`}
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
            <label className={label}>{t("settings.speedLimit")}</label>
            <div className="relative">
              <input
                type="number"
                min={0}
                value={draft.speed_limit_kbps}
                onChange={(e) => set({ speed_limit_kbps: Number(e.target.value) || 0 })}
                className={`${field} pr-16`}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-[var(--muted)]">
                KB/s
              </span>
            </div>
            <p className="mt-1 text-[11.5px] text-[var(--muted)]">{t("settings.speedLimitKbps")}</p>
          </div>

          <div className={grid2}>
            <div>
              <label className={label}>{t("settings.language")}</label>
              <select
                value={draft.language}
                onChange={(e) => set({ language: e.target.value })}
                className={`${field} cursor-pointer`}
              >
                <option value="zh">中文</option>
                <option value="en">English</option>
              </select>
            </div>
            <div>
              <label className={label}>{t("settings.theme")}</label>
              <select
                value={draft.theme}
                onChange={(e) => set({ theme: e.target.value })}
                className={`${field} cursor-pointer`}
              >
                <option value="dark">{t("theme.dark")}</option>
                <option value="light">{t("theme.light")}</option>
                <option value="system">{t("theme.system")}</option>
              </select>
            </div>
          </div>

          <div className="rounded-2xl border border-[var(--accent)]/25 bg-[var(--accent-soft)] p-4">
            <div className="flex items-center gap-2">
              <div className="app-gradient flex h-7 w-7 items-center justify-center rounded-lg text-white">
                <DownloadIcon width={14} height={14} />
              </div>
              <div className="text-[13px] font-bold">{t("settings.extension")}</div>
            </div>
            <p className="mt-1.5 text-[12px] text-[var(--text-2)]">{t("settings.extensionDesc")}</p>
            <button
              onClick={installExtension}
              disabled={extBusy}
              className="app-gradient mt-2.5 flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[12.5px] font-semibold text-white transition hover:brightness-110 active:scale-95 disabled:opacity-60"
            >
              <DownloadIcon width={13} height={13} />
              {extBusy ? "…" : t("settings.extensionInstall")}
            </button>
            <div className="mt-2.5 space-y-1.5 text-[11.5px] text-[var(--text-2)]">
              {browsers && (
                <div>
                  {t("settings.extensionBrowsers")}
                  {browsers.chrome ? " Chrome" : ""}
                  {browsers.edge ? " Edge" : ""}
                  {!browsers.chrome && !browsers.edge ? t("settings.extensionNoBrowser") : ""}
                </div>
              )}
              {extPath && (
                <div className="break-all font-mono text-[11px] text-[var(--muted)]">
                  {t("settings.extensionPath")}: {extPath}
                </div>
              )}
            </div>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <button
                onClick={() => openExtensionsPage("auto")}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold text-[var(--accent)] transition hover:bg-[var(--accent)]/10"
              >
                {t("settings.openExtensionsPage")}
              </button>
              <button
                onClick={copySteps}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold text-[var(--accent)] transition hover:bg-[var(--accent)]/10"
              >
                {copied ? <CheckIcon width={13} height={13} /> : <CopyIcon width={13} height={13} />}
                {copied ? t("action.copy") + " ✓" : t("action.copy")}
              </button>
            </div>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2.5">
          <button
            onClick={onClose}
            className="rounded-xl border border-[var(--border)] bg-[var(--panel-2)] px-5 py-2.5 text-[13.5px] font-semibold text-[var(--text-2)] transition hover:text-[var(--text)]"
          >
            {t("action.close")}
          </button>
          <button
            onClick={saveAll}
            className="app-gradient rounded-xl px-5 py-2.5 text-[13.5px] font-semibold text-white shadow-lg shadow-indigo-500/25 transition hover:brightness-110 active:scale-95"
          >
            {t("action.save")}
          </button>
        </div>
      </div>
    </div>
  );
}