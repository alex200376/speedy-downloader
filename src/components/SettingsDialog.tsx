import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { chooseFolder, EXTENSION_DOWNLOAD_URL, getVideoToolsStatus, installVideoTools, isTauri, openExtensionsPage, openUrl, prepareExtension } from "../api";
import { useSettingsStore } from "../store/settingsStore";
import { useToastStore } from "../store/toastStore";
import type { Settings } from "../types";
import ThemePreview, { ACCENTS, hexToRgba, resolveTheme } from "./ThemePreview";
import {
  XIcon,
  FolderIcon,
  CopyIcon,
  CheckIcon,
  DownloadIcon,
  GlobeIcon,
} from "./icons";

interface InstallProgress {
  phase: string;
  downloaded: number;
  total: number | null;
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "…";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

const THEMES = ["dark", "light", "system"] as const;

const field = "input";
const label = "mb-1.5 block text-[12.5px] font-semibold text-[var(--text-2)]";
const grid2 = "grid grid-cols-2 gap-3";

export default function SettingsDialog({ open, onClose }: Props) {
  const { t } = useTranslation();
  const { settings, save } = useSettingsStore();
  const toast = useToastStore((s) => s.push);
  const [tab, setTab] = useState("appearance");
  const [copied, setCopied] = useState(false);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [extPath, setExtPath] = useState("");
  const [browsers, setBrowsers] = useState<{ chrome: boolean; edge: boolean } | null>(null);
  const [videoTools, setVideoTools] = useState<{ installed: boolean; ytdlp_version: string | null; ffmpeg_version: string | null; path: string } | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installProgress, setInstallProgress] = useState<InstallProgress | null>(null);

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
    getVideoToolsStatus().then((s) => {
      if (s) setVideoTools(s);
    }).catch(() => {});
  }, [open]);

  useEffect(() => {
    if (!installing || !isTauri()) return;
    let unlisten: (() => void) | undefined;
    import("@tauri-apps/api/event").then(({ listen }) =>
      listen<InstallProgress>("tools-install-progress", (e) => {
        setInstallProgress(e.payload);
      }),
    ).then((fn) => { unlisten = fn; });
    return () => {
      unlisten?.();
      setInstallProgress(null);
    };
  }, [installing]);

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

  const resolvedTheme = resolveTheme(draft.theme);
  const proxyMode =
    draft.proxy === "none" ? "none" : draft.proxy === "system" ? "system" : "custom";

  const TABS = [
    { key: "appearance", label: t("settings.appearance") },
    { key: "downloads", label: t("settings.downloads") },
    { key: "behavior", label: t("settings.behavior") },
    { key: "language", label: t("settings.language") },
    { key: "extension", label: t("settings.extension") },
  ];

  const renderTab = () => {
    switch (tab) {
      case "appearance":
        return (
          <>
            <ThemePreview theme={resolvedTheme} accent={draft.accent} />
            <div className="mt-4">
              <label className={label}>{t("settings.theme")}</label>
              <select
                value={draft.theme}
                onChange={(e) => set({ theme: e.target.value })}
                className={`${field} cursor-pointer`}
              >
                {THEMES.map((m) => (
                  <option key={m} value={m}>
                    {t(`theme.${m}`)}
                  </option>
                ))}
              </select>
            </div>
            <div className="mt-4">
              <label className={label}>{t("settings.accent")}</label>
              <div className="flex flex-wrap gap-2">
                {ACCENTS.map((a) => {
                  const active = draft.accent === a.key;
                  const c = resolvedTheme === "light" ? a.light : a.dark;
                  return (
                    <button
                      key={a.key}
                      onClick={() => set({ accent: a.key })}
                      className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold transition ${
                        active ? "" : "border-[var(--border)] text-[var(--text-2)] hover:text-[var(--text)]"
                      }`}
                      style={
                        active
                          ? { borderColor: c, background: hexToRgba(c, 0.12), color: c }
                          : undefined
                      }
                    >
                      <span className="h-3.5 w-3.5 rounded-full" style={{ background: c }} />
                      {a.label}
                      {active && <CheckIcon width={13} height={13} />}
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        );
      case "downloads":
        return (
          <>
            <div>
              <label className={label}>{t("settings.saveDir")}</label>
              <div className="flex gap-2">
                <input value={draft.save_dir} onChange={(e) => set({ save_dir: e.target.value })} className={field} />
                <button onClick={browseDir} className="btn btn-outline shrink-0">
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
              <label className={label}>{t("settings.proxy")}</label>
              <div className="flex gap-2">
                <select
                  value={proxyMode}
                  onChange={(e) => {
                    const m = e.target.value;
                    set({ proxy: m === "custom" ? draft.proxy : m });
                  }}
                  className={`${field} w-32 shrink-0 cursor-pointer`}
                >
                  <option value="system">{t("settings.proxySystem")}</option>
                  <option value="none">{t("settings.proxyNone")}</option>
                  <option value="custom">{t("settings.proxyCustom")}</option>
                </select>
                {proxyMode === "custom" && (
                  <input
                    value={draft.proxy}
                    onChange={(e) => set({ proxy: e.target.value })}
                    placeholder="http://127.0.0.1:7890"
                    className={`${field} font-mono text-[12px]`}
                  />
                )}
              </div>
              {proxyMode === "custom" && (
                <p className="mt-1 text-[11.5px] text-[var(--muted)]">{t("settings.proxyHint")}</p>
              )}
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
          </>
        );
      case "behavior":
        return (
          <>
            <div>
              <label className={label}>{t("settings.duplicatePolicy")}</label>
              <select
                value={draft.duplicate_policy}
                onChange={(e) => set({ duplicate_policy: e.target.value })}
                className={`${field} cursor-pointer`}
              >
                <option value="rename">{t("settings.dupRename")}</option>
                <option value="overwrite">{t("settings.dupOverwrite")}</option>
                <option value="skip">{t("settings.dupSkip")}</option>
              </select>
            </div>
            <label className="flex cursor-pointer items-start gap-2.5">
              <input
                type="checkbox"
                checked={draft.sort_by_type}
                onChange={(e) => set({ sort_by_type: e.target.checked })}
                className="mt-0.5 accent-[var(--accent)]"
              />
              <span className="text-[12.5px] leading-5 text-[var(--text-2)]">
                {t("settings.sortByType")}
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2.5">
              <input
                type="checkbox"
                checked={draft.notify_complete}
                onChange={(e) => set({ notify_complete: e.target.checked })}
                className="mt-0.5 accent-[var(--accent)]"
              />
              <span className="text-[12.5px] leading-5 text-[var(--text-2)]">
                {t("settings.notifyComplete")}
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2.5">
              <input
                type="checkbox"
                checked={draft.open_folder_on_complete}
                onChange={(e) => set({ open_folder_on_complete: e.target.checked })}
                className="mt-0.5 accent-[var(--accent)]"
              />
              <span className="text-[12.5px] leading-5 text-[var(--text-2)]">
                {t("settings.openFolderOnComplete")}
              </span>
            </label>
          </>
        );
      case "language":
        return (
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
        );
      case "extension":
        return (
          <>
            <p className="text-[12px] text-[var(--text-2)]">{t("settings.extensionDesc")}</p>
            <div className="space-y-1.5 text-[11.5px] text-[var(--text-2)]">
              {browsers && (
                <div>
                  {t("settings.extensionBrowsers")}
                  {browsers.chrome ? " Chrome" : ""}
                  {browsers.edge ? " Edge" : ""}
                  {!browsers.chrome && !browsers.edge ? t("settings.extensionNoBrowser") : ""}
                </div>
              )}
              {extPath && (
                <div className="break-all rounded-md bg-[var(--bg-2)] px-2 py-1.5 font-mono text-[11px] text-[var(--muted)]">
                  {extPath}
                </div>
              )}
            </div>
            <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--bg-2)]/50 p-3.5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[12.5px] font-semibold text-[var(--text)]">Video download tools (yt-dlp + ffmpeg)</div>
                  <div className="mt-1 text-[11.5px] text-[var(--text-2)]">
                    {videoTools?.installed
                      ? `Installed · yt-dlp ${videoTools.ytdlp_version ?? "?"} · ffmpeg ${videoTools.ffmpeg_version ?? "?"}`
                      : "Not installed"}
                  </div>
                  <div className="mt-1 break-all font-mono text-[11px] text-[var(--muted)]">
                    {videoTools?.path ?? ""}
                  </div>
                </div>
                <button
                  onClick={async () => {
                    setInstalling(true);
                    try {
                      const s = await installVideoTools();
                      if (s) {
                        setVideoTools(s);
                        toast("success", s.installed ? "Tools installed successfully" : "Install completed");
                      } else {
                        toast("error", "Install failed — is the app running?");
                      }
                    } catch (e) {
                      toast("error", `Install failed: ${String(e)}`);
                    } finally {
                      setInstalling(false);
                    }
                  }}
                  disabled={installing}
                  className="btn btn-outline px-2 text-[12px]"
                >
                  <DownloadIcon width={13} height={13} />
                  {installing ? "Installing..." : videoTools?.installed ? "Reinstall / Update" : "Install tools"}
                </button>
              </div>
              {installing && installProgress && (() => {
                const pct = installProgress.total && installProgress.total > 0
                  ? Math.min(100, (installProgress.downloaded / installProgress.total) * 100)
                  : null;
                const phaseLabel = installProgress.phase === "yt-dlp" ? "Downloading yt-dlp…"
                  : installProgress.phase === "ffmpeg" ? "Downloading ffmpeg…"
                  : installProgress.phase === "extracting" ? "Extracting ffmpeg…"
                  : "Working…";
                return (
                  <div className="mt-3">
                    <div className="flex items-center justify-between text-[11px] text-[var(--text-2)]">
                      <span>{phaseLabel}</span>
                      <span>
                        {installProgress.total
                          ? `${formatBytes(installProgress.downloaded)} / ${formatBytes(installProgress.total)}${pct !== null ? ` (${pct.toFixed(0)}%)` : ""}`
                          : formatBytes(installProgress.downloaded)}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg)]">
                      {pct !== null ? (
                        <div
                          className="h-full rounded-full bg-[var(--accent)] transition-all duration-300"
                          style={{ width: `${pct}%` }}
                        />
                      ) : (
                        <div className="h-full w-1/3 animate-pulse rounded-full bg-[var(--accent)]" />
                      )}
                    </div>
                  </div>
                );
              })()}
              <p className="mt-2 text-[11px] text-[var(--muted)]">
                yt-dlp (~17.5MB) + ffmpeg (~80MB) will be downloaded on first install. Windows Defender may flag them as false-positive.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
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
              <button onClick={copySteps} className="btn btn-ghost px-2 text-[12px]">
                {copied ? <CheckIcon width={13} height={13} /> : <CopyIcon width={13} height={13} />}
                {copied ? t("action.copy") + " ✓" : t("action.copy")}
              </button>
            </div>
          </>
        );
      default:
        return null;
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="animate-pop flex max-h-[90vh] w-full max-w-xl flex-col rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-[var(--shadow)]">
        <div className="flex shrink-0 items-center justify-between px-6 pt-5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--panel-2)] text-[var(--text)]">
              <GlobeIcon width={17} height={17} />
            </div>
            <h2 className="text-[16px] font-bold">{t("settings.title")}</h2>
          </div>
          <button onClick={onClose} className="icon-btn">
            <XIcon width={16} height={16} />
          </button>
        </div>

        <div className="mt-3 flex shrink-0 gap-1 border-b border-[var(--border)] px-4">
          {TABS.map((tb) => (
            <button
              key={tb.key}
              onClick={() => setTab(tb.key)}
              className={`-mb-px border-b-2 px-3.5 py-2 text-[12.5px] font-semibold transition ${
                tab === tb.key
                  ? "border-[var(--accent)] text-[var(--accent)]"
                  : "border-transparent text-[var(--muted)] hover:text-[var(--text)]"
              }`}
            >
              {tb.label}
            </button>
          ))}
        </div>

        <div className="space-y-4 overflow-y-auto px-6 py-5">{renderTab()}</div>

        <div className="flex shrink-0 items-center justify-end gap-2.5 border-t border-[var(--border-soft)] px-6 py-4">
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