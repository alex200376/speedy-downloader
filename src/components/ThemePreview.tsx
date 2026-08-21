import { useTranslation } from "react-i18next";
import { ZapIcon, SearchIcon, ClockIcon, FileGlyph } from "./icons";

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
  text: string;
  text2: string;
  accent: string;
  green: string;
}

export function hexToRgba(hex: string, alpha: number): string {
  const v = parseInt(hex.replace("#", ""), 16);
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
        text: "#18181b",
        text2: "#52525b",
      }
    : {
        bg: "#09090b",
        panel: "#101114",
        panel2: "#1a1b1f",
        border: "#26272b",
        text: "#f4f4f5",
        text2: "#a1a1aa",
      };
  const def = ACCENTS.find((a) => a.key === accentKey) ?? ACCENTS[0];
  return {
    ...base,
    accent: light ? def.light : def.dark,
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

  return (
    <div className="overflow-hidden rounded-lg border" style={{ background: p.panel, borderColor: p.border }}>
      <div
        className="flex items-center gap-2 px-3 py-2"
        style={{ borderBottom: `1px solid ${p.border}` }}
      >
        <div
          className="flex h-5 w-5 items-center justify-center rounded-md"
          style={{ background: p.accent, color: p.bg }}
        >
          <ZapIcon width={11} height={11} />
        </div>
        <span className="text-[11px] font-bold" style={{ color: p.text }}>
          {t("appName")}
        </span>
        <div className="flex-1" />
        <SearchIcon width={12} height={12} style={{ color: p.text2 }} />
      </div>
      <div className="px-3 py-2.5">
        <div
          className="rounded-lg border p-2.5"
          style={{ background: p.panel2, borderColor: p.border }}
        >
          <div className="flex items-center gap-2">
            <div
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
              style={{ background: hexToRgba("#f59e0b", 0.14), color: "#f59e0b" }}
            >
              <FileGlyph kind="package" width={13} height={13} />
            </div>
            <div className="min-w-0 flex-1 truncate text-[10.5px] font-semibold" style={{ color: p.text }}>
              electron-v33.2.0.zip
            </div>
            <ClockIcon width={11} height={11} style={{ color: p.accent }} />
          </div>
          <div className="mt-2 h-1 w-full overflow-hidden rounded-full" style={{ background: p.border }}>
            <div className="h-full rounded-full" style={{ width: "68%", background: p.accent }} />
          </div>
          <div className="mt-1.5 text-[9px] font-semibold tabular-nums" style={{ color: p.accent }}>
            68% · 12.4 MB/s
          </div>
        </div>
      </div>
    </div>
  );
}