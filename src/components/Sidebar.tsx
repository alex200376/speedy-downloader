import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useTaskStats, useTaskStore } from "../store/taskStore";
import { useSettingsStore } from "../store/settingsStore";
import type { FilterKey } from "../types";
import {
  ZapIcon,
  PlusIcon,
  SettingsIcon,
  SunIcon,
  MoonIcon,
  GlobeIcon,
  PauseIcon,
  ClockIcon,
  CheckIcon,
  AlertIcon,
  PlaylistIcon,
} from "./icons";

interface Props {
  collapsed?: boolean;
  onNew: () => void;
  onSettings: () => void;
  onPlaylist: () => void;
}

const FILTER_ICONS: Record<FilterKey, ReactNode> = {
  all: <ZapIcon width={17} height={17} />,
  downloading: <ClockIcon width={17} height={17} />,
  completed: <CheckIcon width={17} height={17} />,
  paused: <PauseIcon width={17} height={17} />,
  error: <AlertIcon width={17} height={17} />,
};

export default function Sidebar({ collapsed, onNew, onSettings, onPlaylist }: Props) {
  const { t, i18n } = useTranslation();
  const { filter, setFilter } = useTaskStore();
  const stats = useTaskStats();
  const settings = useSettingsStore((s) => s.settings);
  const saveSettings = useSettingsStore((s) => s.save);

  const theme = settings?.theme ?? "dark";
  const lang = i18n.language === "zh" ? "中文" : "English";

  const toggleTheme = () => {
    if (!settings) return;
    saveSettings({ ...settings, theme: settings.theme === "dark" ? "light" : "dark" });
  };

  const toggleLanguage = () => {
    if (!settings) return;
    saveSettings({ ...settings, language: lang === "中文" ? "en" : "zh" });
  };

  const items: { key: FilterKey; count: number }[] = [
    { key: "all", count: stats.all },
    { key: "downloading", count: stats.downloading },
    { key: "completed", count: stats.completed },
    { key: "paused", count: stats.paused },
    { key: "error", count: stats.error },
  ];

  if (collapsed) {
    return (
      <aside className="flex h-full w-[52px] shrink-0 flex-col items-center border-r border-[var(--border-soft)] bg-[var(--bg-2)]/60 py-3 gap-2">
        <button
          onClick={onNew}
          title={t("header.newDownload")}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--accent)] text-[var(--bg)] transition hover:brightness-110"
        >
          <PlusIcon width={16} height={16} />
        </button>

        <button
          onClick={onPlaylist}
          title={t("header.playlist") || "Playlist"}
          className="icon-btn"
        >
          <PlaylistIcon width={17} height={17} />
        </button>

        <div className="my-1 h-px w-6 bg-[var(--border)]" />

        <nav className="flex flex-col items-center gap-1">
          {items.map((item) => (
            <button
              key={item.key}
              onClick={() => setFilter(item.key)}
              title={`${t(`nav.${item.key}`)}${item.count > 0 ? ` (${item.count})` : ""}`}
              className={`flex h-9 w-9 items-center justify-center rounded-md transition ${
                filter === item.key
                  ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                  : "text-[var(--text-2)] hover:bg-[var(--panel)] hover:text-[var(--text)]"
              }`}
            >
              {FILTER_ICONS[item.key]}
            </button>
          ))}
        </nav>

        <div className="mt-auto flex flex-col items-center gap-1">
          <button onClick={toggleTheme} title="Toggle theme" className="icon-btn">
            {theme === "dark" ? <SunIcon width={17} height={17} /> : <MoonIcon width={17} height={17} />}
          </button>
          <button onClick={toggleLanguage} title="Language / 语言" className="icon-btn">
            <GlobeIcon width={15} height={15} />
          </button>
          <button onClick={onSettings} title={t("settings.title")} className="icon-btn">
            <SettingsIcon width={17} height={17} />
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-[var(--border-soft)] bg-[var(--bg-2)]/60">
      <div className="flex items-center gap-2.5 px-5 pt-5 pb-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--panel-2)] text-[var(--text)]">
          <ZapIcon width={19} height={19} />
        </div>
        <div>
          <div className="text-[15px] font-bold leading-tight tracking-tight">{t("appName")}</div>
        </div>
      </div>

      <div className="px-3 pb-2 space-y-2">
        <button onClick={onNew} className="btn btn-primary w-full">
          <PlusIcon width={15} height={15} />
          {t("header.newDownload")}
        </button>
        <button onClick={onPlaylist} className="btn btn-outline w-full">
          <PlaylistIcon width={15} height={15} />
          {t("header.playlist") || "Playlist"}
        </button>
      </div>

      <nav className="mt-2 flex-1 space-y-0.5 overflow-y-auto px-3">
        {items.map((item) => (
          <button
            key={item.key}
            onClick={() => setFilter(item.key)}
            className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-[13.5px] transition ${
              filter === item.key
                ? "bg-[var(--accent-soft)] font-semibold text-[var(--accent)]"
                : "text-[var(--text-2)] hover:bg-[var(--panel)] hover:text-[var(--text)]"
            }`}
          >
            <span className={filter === item.key ? "text-[var(--accent)]" : ""}>
              {FILTER_ICONS[item.key]}
            </span>
            <span className="flex-1 text-left">{t(`nav.${item.key}`)}</span>
            {item.count > 0 && (
              <span
                className={`rounded px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${
                  filter === item.key
                    ? "bg-[var(--text)] text-[var(--bg)]"
                    : "bg-[var(--panel-2)] text-[var(--muted)]"
                }`}
              >
                {item.count}
              </span>
            )}
          </button>
        ))}
      </nav>

      <div className="flex items-center gap-2 border-t border-[var(--border-soft)] px-3 py-3">
        <button onClick={toggleTheme} title="Toggle theme" className="icon-btn shrink-0">
          {theme === "dark" ? <SunIcon width={17} height={17} /> : <MoonIcon width={17} height={17} />}
        </button>
        <button
          onClick={toggleLanguage}
          title="Language / 语言"
          className="btn btn-ghost h-8 flex-1 px-0 text-[12.5px] font-semibold"
        >
          <GlobeIcon width={15} height={15} />
          {lang}
        </button>
        <button onClick={onSettings} title={t("settings.title")} className="icon-btn shrink-0">
          <SettingsIcon width={17} height={17} />
        </button>
      </div>
    </aside>
  );
}
