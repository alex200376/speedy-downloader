import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { chooseFolder, EXTENSION_DOWNLOAD_URL, openExtensionsPage, openUrl, prepareExtension } from "../api";
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
  SunIcon,
  MoonIcon,
  MonitorIcon,
  GlobeIcon,
  ShieldIcon,
} from "./icons";

interface Props {
  open: boolean;
  onClose: () => void;
}

const THEMES = ["dark", "light", "system"] as const;

function Section({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)]/40 p-4">
      <div className="mb-3.5 flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--panel)] text-[var(--text-2)]">
          {icon}
        </span>
        <span className="text-[12.5px] font-bold tracking-wide text-[var(--text-2)]">
          {title}
        </span>
      </div>
      <div className="space-y-3.5">{children}</div>
    </div>
  );
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
  const resolvedTheme = resolveTheme(draft.theme);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="animate-pop flex max-h-[90vh] w-full max-w-xl flex-col rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-[var(--shadow)]">
        <div className="mb-4 flex shrink-0 items-center justify-between px-6 pt-5">
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

        <div className="space-y-4 overflow-y-auto px-6 pb-6">
          {/* Appearance */}
          <div>
            <div className="mb-2 text-[11.5px] font-bold uppercase tracking-widest text-[var(--muted)]">
              {t("settings.appearance")}
            </div>
            <ThemePreview theme={resolvedTheme} accent={draft.accent} />

            <div className="mt-3">
              <label className={label}>{t("settings.theme")}</label>
              <div className="seg">
                {THEMES.map((m) => (
                  <button
                    key={m}
                    onClick={() => set({ theme: m })}
                    className={`seg-btn flex-1 ${draft.theme === m ? "on" : ""}`}
                  >
                    {m === "dark" ? (
                      <MoonIcon width={14} height={14} />
                    ) : m === "light" ? (
                      <SunIcon width={14} height={14} />
                    ) : (
                      <MonitorIcon width={14} height={14} />
                    )}
                    {t(`theme.${m}`)}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-3.5">
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
          </div>

          {/* Downloads */}
          <Section icon={<DownloadIcon width={14} height={14} />} title={t("settings.downloads")}>
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
          </Section>

          {/* Language */}
          <Section icon={<GlobeIcon width={14} height={14} />} title={t("settings.language")}>
            <select
              value={draft.language}
              onChange={(e) => set({ language: e.target.value })}
              className={`${field} cursor-pointer`}
            >
              <option value="zh">中文</option>
              <option value="en">English</option>
            </select>
          </Section>

          {/* Behavior */}
          <Section icon={<ShieldIcon width={14} height={14} />} title={t("settings.behavior")}>
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
          </Section>

          {/* Extension */}
          <Section icon={<GlobeIcon width={14} height={14} />} title={t("settings.extension")}>
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
          </Section>
        </div>

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
