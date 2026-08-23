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

const VIDEO_QUALITIES = [
  { key: "best", label: "Best (video+audio)", labelZh: "最佳（视频+音频）" },
  { key: "2160p", label: "4K (2160p)", labelZh: "4K (2160p)" },
  { key: "1080p", label: "1080p", labelZh: "1080p" },
  { key: "720p", label: "720p", labelZh: "720p" },
  { key: "480p", label: "480p", labelZh: "480p" },
  { key: "360p", label: "360p", labelZh: "360p" },
  { key: "video", label: "Video only", labelZh: "仅视频" },
  { key: "audio", label: "Audio only", labelZh: "仅音频" },
] as const;

const VIDEO_HOSTS = [
  "youtube.com", "youtu.be",
  "twitter.com", "x.com",
  "bilibili.com",
  "tiktok.com",
  "instagram.com",
  "facebook.com", "fb.watch",
  "vimeo.com",
  "dailymotion.com",
  "twitch.tv",
  "reddit.com", "redd.it",
  "vk.com",
  "ok.ru",
  "nicovideo.jp", "nico.ms",
  "douyin.com",
  "ixigua.com",
  "v.qq.com",
  "iqiyi.com",
  "youku.com",
  "mgtv.com",
];

function isVideoHost(url: string): boolean {
  try {
    let u = url.trim().toLowerCase();
    if (!/^https?:\/\//i.test(u)) return false;
    return VIDEO_HOSTS.some((h) => u.includes("://" + h) || u.includes("www." + h));
  } catch {
    return false;
  }
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
  const [headersText, setHeadersText] = useState("");
  const [writeSubs, setWriteSubs] = useState(false);
  const [subLang, setSubLang] = useState("en");
  const [subFormat, setSubFormat] = useState<string | null>(null);
  const [availableSubs, setAvailableSubs] = useState<{ code: string; name: string; auto: boolean }[]>([]);
  const [subsLoading, setSubsLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const isGrab = !!grab;
  const isVideo = isVideoHost(url) || grab?.kind === "video";
  const [quality, setQuality] = useState<string>("best");

  useEffect(() => {
    if (open) {
      setUrl(grab?.url ?? initialUrl ?? "");
      setFilename(grab?.filename ?? "");
      setSaveDir(grab?.save_dir ?? settings?.save_dir ?? "");
      setSegments(settings?.default_segments ?? 8);
      setReferer(grab?.referer ?? "");
      setHeadersText("");
      setError("");
      setQuality("best");
      setWriteSubs(false);
      setSubLang("en");
      setSubFormat(null);
      setAvailableSubs([]);
    }
  }, [open, initialUrl, grab, settings]);

  const detectSubtitles = async (videoUrl: string) => {
    if (!videoUrl.trim() || subsLoading) return;
    setSubsLoading(true);
    try {
      const result = await api.listSubtitles(videoUrl.trim());
      if (result.subtitles && result.subtitles.length > 0) {
        setAvailableSubs(result.subtitles);
        // Auto-select first manual sub, or first auto sub if none manual
        const manual = result.subtitles.find((s) => !s.auto);
        if (manual) {
          setSubLang(manual.code);
          setWriteSubs(true);
        }
      } else {
        setAvailableSubs([]);
      }
    } catch {
      setAvailableSubs([]);
    } finally {
      setSubsLoading(false);
    }
  };

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

  const parseHeaders = (): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const raw of headersText.split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const idx = line.indexOf(":");
      if (idx <= 0) continue;
      const k = line.slice(0, idx).trim();
      const v = line.slice(idx + 1).trim();
      if (k) out[k] = v;
    }
    return out;
  };

  const submit = async () => {
    if (!/^https?:\/\//i.test(url.trim())) {
      setError(t("dialog.invalidUrl"));
      return;
    }
    const headers = parseHeaders();
    const kind = isVideo ? "video" : "http";
    setBusy(true);
    if (grab) {
      const { task, error: err } = await api.confirmTask(grab.id, {
        filename: filename.trim() || undefined,
        save_dir: saveDir.trim() || undefined,
        segments,
        headers,
        quality: isVideo ? quality : undefined,
        write_subs: isVideo && writeSubs,
        sub_lang: isVideo && writeSubs ? subLang : undefined,
        sub_format: isVideo && writeSubs ? subFormat : undefined,
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
      headers,
      kind,
      quality: isVideo ? quality : undefined,
      write_subs: isVideo && writeSubs,
      sub_lang: isVideo && writeSubs ? subLang : undefined,
      sub_format: isVideo && writeSubs ? subFormat : undefined,
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
      <div className="animate-pop flex max-h-[min(88vh,44rem)] w-full max-w-[min(32rem,calc(100vw-1.5rem))] flex-col rounded-lg border border-[var(--border)] bg-[var(--panel)] shadow-[var(--shadow)]">
        <div className="mb-3 flex shrink-0 items-center justify-between px-4 pt-4 sm:px-5 sm:pt-5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--panel-2)] text-[var(--text)]">
              <ZapIcon width={15} height={15} />
            </div>
            <h2 className="truncate text-[15px] font-bold">
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

        <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto px-4 pb-2 sm:px-5">
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

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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

          <div>
            <label className="mb-1.5 block text-[12.5px] font-semibold text-[var(--text-2)]">
              {t("dialog.customHeaders")}
            </label>
            <textarea
              value={headersText}
              onChange={(e) => setHeadersText(e.target.value)}
              placeholder={"Cookie: …\nUser-Agent: …\nAuthorization: Bearer …"}
              rows={2}
              className={`${input} resize-none font-mono text-[12.5px]`}
            />
          </div>

          {isVideo && (
            <>
              <div>
                <label className="mb-1.5 block text-[12.5px] font-semibold text-[var(--text-2)]">
                  {t("dialog.videoQuality")}
                </label>
                <select
                  value={quality}
                  onChange={(e) => setQuality(e.target.value)}
                  className={`${input} cursor-pointer`}
                >
                  {VIDEO_QUALITIES.map((q) => (
                    <option key={q.key} value={q.key}>
                      {t("videoQuality." + q.key, q.key)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label className="text-[12.5px] font-semibold text-[var(--text-2)]">
                    {t("dialog.writeSubs") || "Subtitles"}
                  </label>
                  {url.trim() && isVideo && (
                    <button
                      type="button"
                      onClick={() => detectSubtitles(url)}
                      disabled={subsLoading}
                      className="text-[11px] text-[var(--accent)] hover:underline"
                    >
                      {subsLoading
                        ? (t("verify.computing") || "Detecting…")
                        : (t("dialog.detectSubs") || "Auto-detect")}
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <label className="flex cursor-pointer items-center gap-2 text-[12.5px]">
                    <input
                      type="checkbox"
                      checked={writeSubs}
                      onChange={(e) => setWriteSubs(e.target.checked)}
                      className="h-4 w-4 rounded border-[var(--border)] accent-[var(--accent)]"
                    />
                    {t("dialog.enableSubs") || "Enable"}
                  </label>
                </div>
                {writeSubs && (
                  <>
                    <div className="mt-2">
                    {availableSubs.length > 0 ? (
                      <select
                        value={subLang}
                        onChange={(e) => setSubLang(e.target.value)}
                        className={`${input} cursor-pointer`}
                      >
                        {availableSubs.map((s) => (
                          <option key={s.code} value={s.code}>
                            {s.name || s.code}{s.auto ? " (auto)" : ""} — {s.code}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        value={subLang}
                        onChange={(e) => setSubLang(e.target.value)}
                        placeholder="en, zh, ja, ko…"
                        className={input}
                      />
                    )}
                  </div>
                  <div className="mt-2">
                    <select
                      value={subFormat ?? ""}
                      onChange={(e) => setSubFormat(e.target.value || null)}
                      className={`${input} cursor-pointer`}
                    >
                      <option value="">{t("dialog.subFormatAuto") || "Auto (no conversion)"}</option>
                      <option value="srt">SRT</option>
                      <option value="vtt">VTT</option>
                      <option value="ass">ASS</option>
                    </select>
                  </div>
                  </>
                )}
              </div>
            </>
          )}

          {error && (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-[12.5px] text-rose-400">
              {error}
            </div>
          )}

          <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-[var(--border-soft)] px-4 py-3 sm:flex-row sm:items-center sm:justify-end sm:px-5">
            <button
              onClick={isGrab ? handleReject : onClose}
              disabled={busy}
              className="btn btn-outline w-full disabled:opacity-50 sm:w-auto"
            >
              {isGrab ? t("action.cancel") : t("action.close")}
            </button>
            <button
              onClick={submit}
              disabled={busy}
              className="btn btn-primary w-full sm:w-auto"
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