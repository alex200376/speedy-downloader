import { useTranslation } from "react-i18next";
import {
  ZapIcon,
  PlusIcon,
  SearchIcon,
  CheckIcon,
  ClockIcon,
  FileGlyph,
} from "./icons";

export interface AccentDef {
  key: string;
  label: string;
  dark: string;
  light: string;
}

export const ACCENTS: AccentDef[] = [
  { key: "zinc", label: "Zinc", dark: "#d4d4d8", light: "#52525b" },
  { key: "orange", label: "Orange", dark: "#fb923c", light: "#f97316" },
  { key: "amber", label: "Amber", dark: "#fbbf24", light: "#d97706" },
  { key: "emerald", label: "Emerald", dark: "#34d399", light: "#059669" },
  { key: "sky", label: "Sky", dark: "#38bdf8", light: "#0284c7" },
  { key: "violet", label: "Violet", dark: "#a78bfa", light: "#7c3aed" },
  { key: "rose", label: "Rose", dark: "#fb7185", light: "#e11d48" },
];

export interface Palette {
  bg: string;
  panel: string;
  panel2: string;
  border: string;
  borderSoft: string;
  text: string;
  text2: string;
  muted: string;
  accent: string;
  accentSoft: string;
  green: string;
}

export function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const v = parseInt(h, 16);
  const r = (v >> 16) & 255;
  const g = (v >> 8) & 255;
  const b = v & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function themePalette(theme: string, accentKey: string): Palette {
  const light = theme === "light";
  const base = light
    ? {
        bg: "#fafafa",
        panel: "#ffffff",
        panel2: "#f4f4f5",
        border: "#e4e4e7",
        borderSoft: "#e8e8eb",
        text: "#18181b",
        text2: "#52525b",
        muted: "#86868e",
      }
    : {
        bg: "#09090b",
        panel: "#101114",
        panel2: "#1a1b1f",
        border: "#26272b",
        borderSoft: "#17181c",
        text: "#f4f4f5",
        text2: "#a1a1aa",
        muted: "#71717a",
      };
  const def = ACCENTS.find((a) => a.key === accentKey) ?? ACCENTS[0];
  const accent = light ? def.light : def.dark;
  return {
    ...base,
    accent,
    accentSoft: hexToRgba(accent, 0.15),
    green: "#34d399",
  };
}

export function resolveTheme(theme: string): string {
  if (theme === "light") return "light";
  if (theme === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return "dark";
}

interface Props {
  theme: string;
  accent: string;
}

export default function ThemePreview({ theme, accent }: Props) {
  const { t } = useTranslation();
  const p = themePalette(theme, accent);

  const navItems: { key: string; icon: React.ReactNode; count?: string }[] = [
    { key: "all", icon: <ZapIcon width={12} height={12} />, count: "3" },
    { key: "downloading", icon: <ClockIcon width={12} height={12} />, count: "1" },
    { key: "completed", icon: <CheckIcon width={12} height={12} /> },
    { key: "paused", icon: <ClockIcon width={12} height={12} /> },
  ];

  return (
    <div
      className="overflow-hidden rounded-lg border"
      style={{ background: p.bg, borderColor: p.border }}
    >
      <div className="flex" style={{ height: 214 }}>
        <div
          className="flex w-[38%] flex-col border-r px-2 py-3"
          style={{ background: p.panel2, borderColor: p.borderSoft }}
        >
          <div className="flex items-center gap-1.5 px-1">
            <div
              className="flex h-6 w-6 items-center justify-center rounded-md border"
              style={{ background: p.panel, borderColor: p.border, color: p.text }}
            >
              <ZapIcon width={13} height={13} />
            </div>
            <span className="text-[11px] font-bold" style={{ color: p.text }}>
              {t("appName")}
            </span>
          </div>
          <div
            className="mt-2.5 mb-2 flex items-center justify-center gap-1 rounded-md px-2 py-1.5 text-[10.5px] font-semibold"
            style={{ background: p.accent, color: p.bg }}
          >
            <PlusIcon width={11} height={11} />
            {t("header.newDownload")}
          </div>
          <div className="space-y-0.5">
            {navItems.map((it, i) => {
              const active = i === 0;
              return (
                <div
                  key={it.key}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[10.5px] font-medium"
                  style={
                    active
                      ? { background: p.accentSoft, color: p.accent }
                      : { color: p.text2 }
                  }
                >
                  <span>{it.icon}</span>
                  <span className="flex-1">{t(`nav.${it.key}`)}</span>
                  {it.count && (
                    <span
                      className="rounded px-1 text-[9.5px] font-semibold tabular-nums"
                      style={
                        active
                          ? { background: p.accent, color: p.bg }
                          : { background: p.panel, color: p.muted }
                      }
                    >
                      {it.count}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex-1 px-2.5 py-3">
          <div
            className="flex items-center gap-2 pb-2.5"
            style={{ borderBottom: `1px solid ${p.borderSoft}` }}
          >
            <div className="relative w-28">
              <SearchIcon
                width={11}
                height={11}
                className="absolute left-2 top-1/2 -translate-y-1/2"
                style={{ color: p.muted }}
              />
              <div
                className="h-6 rounded-md border pl-6 pr-2"
                style={{ background: p.bg, borderColor: p.border }}
              />
            </div>
            <div className="flex-1" />
            <div
              className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[10px] font-semibold"
              style={{ background: p.accent, color: p.bg }}
            >
              <PlusIcon width={10} height={10} />
              {t("header.newDownload")}
            </div>
          </div>

          <div className="mt-2.5 space-y-2">
            <TaskMock
              p={p}
              iconColor="#f59e0b"
              iconKind="package"
              name="electron-v33.2.0.zip"
              url="https://cdn.npmmirror.com/binaries/electron/…"
              progress={0.68}
              meta="78.3 MB / 114.9 MB · 68.1%"
              speed="12.4 MB/s"
              downloading
            />
            <TaskMock
              p={p}
              iconColor="#34d399"
              iconKind="package"
              name="node-v22.0.0.zip"
              url="https://cdn.npmmirror.com/binaries/node/…"
              progress={1}
              meta="100%"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function TaskMock({
  p,
  iconColor,
  iconKind,
  name,
  url,
  progress,
  meta,
  speed,
  downloading,
}: {
  p: Palette;
  iconColor: string;
  iconKind: string;
  name: string;
  url: string;
  progress: number;
  meta: string;
  speed?: string;
  downloading?: boolean;
}) {
  return (
    <div
      className="rounded-lg border p-2"
      style={{ background: p.panel, borderColor: p.border }}
    >
      <div className="flex items-center gap-2">
        <div
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
          style={{ background: hexToRgba(iconColor, 0.12), color: iconColor }}
        >
          <FileGlyph kind={iconKind} width={14} height={14} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[10.5px] font-semibold" style={{ color: p.text }}>
            {name}
          </div>
          <div className="truncate text-[9px]" style={{ color: p.muted }}>
            {url}
          </div>
        </div>
      </div>
      <div
        className="mt-1.5 h-1 w-full overflow-hidden rounded-full"
        style={{ background: p.panel2 }}
      >
        <div
          className="h-full rounded-full"
          style={{
            width: `${Math.min(1, Math.max(0, progress)) * 100}%`,
            background: progress >= 1 ? p.green : p.accent,
            opacity: downloading ? 0.75 : 1,
          }}
        />
      </div>
      <div
        className="mt-1 flex items-center gap-2 text-[9px] tabular-nums"
        style={{ color: p.text2 }}
      >
        <span>{meta}</span>
        {downloading && speed && (
          <span className="font-semibold" style={{ color: p.accent }}>
            {speed}
          </span>
        )}
      </div>
    </div>
  );
}
