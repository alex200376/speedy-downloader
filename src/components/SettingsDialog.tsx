import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { chooseFolder, EXTENSION_DOWNLOAD_URL, openExtensionsPage, openUrl, prepareExtension } from "../api";
import { useSettingsStore } from "../store/settingsStore";
import { useToastStore } from "../store/toastStore";
import type { Settings } from "../types";
import { XIcon, FolderIcon, CopyIcon, CheckIcon, DownloadIcon } from "./icons";

const ACCENTS: { key: string; color: string }[] = [
  { key: "zinc", color: "#d4d4d8" },
  { key: "orange", color: "#fb923c" },
  { key: "amber", color: "#fbbf24" },
  { key: "emerald", color: "#34d399" },
  { key: "sky", color: "#38bdf8" },
  { key: "violet", color: "#a78bfa" },
  { key: "rose", color: "#fb7185" },
];

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
  const [extPath, setExtPath] = useState("");
  const [browsers, setBrowsers] = useState<{ chrome: boolean; edge: boolean } | null>(null);

  useEffect(() => {
    if (open && settings) setDraft(settings);
  }, [open, settings]);

  useEffect(() => {
    if (!open) return;
    prepareExtension()
      .then((info) => {
        if (info) {
          setExtPath(info.path);
          setBrowsers({ chrome: info.chrome, edge: info.edge });
        }
      })
      .catch(() => {});
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

  const field = "input";
  const label = "mb-1.5 block text-[12.5px] font-semibold text-[var(--text-2)]";
  const grid2 = "grid grid-cols-2 gap-3";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="animate-pop w-full max-w-xl rounded-lg border border-[var(--border)] bg-[var(--panel)] p-6 shadow-[var(--shadow)]">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-[16px] font-bold">{t("settings.title")}</h2>
          <button onClick={onClose} className="icon-btn">
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
                className="btn btn-outline shrink-0"
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

          <div>
            <label className={label}>{t("settings.accent")}</label>
            <div className="flex flex-wrap items-center gap-2.5">
              {ACCENTS.map((a) => (
                <button
                  key={a.key}
                  onClick={() => set({ accent: a.key })}
                  title={a.key}
                  className={`h-7 w-7 rounded-full border-2 transition hover:scale-110 ${
                    draft.accent === a.key
                      ? "border-[var(--text)]"
                      : "border-[var(--border)]"
                  }`}
                  style={{ background: a.color }}
                />
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)]/60 p-4">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--panel)] text-[var(--text)]">
                <DownloadIcon width={14} height={14} />
              </div>
              <div className="text-[13px] font-bold">{t("settings.extension")}</div>
            </div>
            <p className="mt-1.5 text-[12px] text-[var(--text-2)]">{t("settings.extensionDesc")}</p>
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
                onClick={() => openUrl(EXTENSION_DOWNLOAD_URL)}
                className="btn btn-outline px-2 text-[12px]"
              >
                <DownloadIcon width={13} height={13} />
                {t("settings.extensionDownload")}
              </button>
              <button
                onClick={() => openExtensionsPage("auto")}
                className="btn btn-ghost px-2 text-[12px]"
              >
                {t("settings.openExtensionsPage")}
              </button>
              <button
                onClick={copySteps}
                className="btn btn-ghost px-2 text-[12px]"
              >
                {copied ? <CheckIcon width={13} height={13} /> : <CopyIcon width={13} height={13} />}
                {copied ? t("action.copy") + " ✓" : t("action.copy")}
              </button>
            </div>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2.5">
          <button onClick={onClose} className="btn btn-outline">
            {t("action.close")}
          </button>
          <button onClick={saveAll} className="btn btn-primary">
            {t("action.save")}
          </button>
        </div>
      </div>
    </div>
  );
}