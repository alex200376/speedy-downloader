import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, checkUpdate, formatBytes, openUrl } from "../api";
import { useSettingsStore } from "../store/settingsStore";
import { useToastStore } from "../store/toastStore";
import type { UpdateInfo } from "../types";
import { XIcon, DownloadIcon, ExternalIcon, CheckIcon } from "./icons";

interface Props {
  open: boolean;
  onClose: () => void;
}

type State =
  | { kind: "checking" }
  | { kind: "result"; info: UpdateInfo | null }
  | { kind: "error"; message: string };

export default function UpdateDialog({ open, onClose }: Props) {
  const { t } = useTranslation();
  const settings = useSettingsStore((s) => s.settings);
  const toast = useToastStore((s) => s.push);
  const [state, setState] = useState<State>({ kind: "checking" });

  const check = async () => {
    setState({ kind: "checking" });
    const info = await checkUpdate();
    if (info === null) {
      setState({ kind: "error", message: t("update.failed") });
      return;
    }
    setState({ kind: "result", info });
  };

  useEffect(() => {
    if (open) check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const downloadUpdate = async () => {
    if (state.kind !== "result" || !state.info) return;
    const { task, error } = await api.createTask({
      url: state.info.asset_url,
      save_dir: settings?.save_dir,
      segments: settings?.default_segments ?? 8,
    });
    if (task) {
      toast("success", t("update.downloadStarted"));
      onClose();
    } else {
      toast("error", error ?? t("toast.error"));
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="animate-pop w-full max-w-md rounded-lg border border-[var(--border)] bg-[var(--panel)] p-6 shadow-[var(--shadow)]">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[16px] font-bold">{t("update.title")}</h2>
          <button onClick={onClose} className="icon-btn">
            <XIcon width={16} height={16} />
          </button>
        </div>

        {state.kind === "checking" && (
          <div className="flex items-center gap-3 py-6 text-[13.5px] text-[var(--text-2)]">
            <div className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--accent)]" />
            {t("update.checking")}
          </div>
        )}

        {state.kind === "error" && (
          <div className="space-y-4 py-2">
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-[12.5px] text-rose-400">
              {state.message}
            </div>
            <div className="flex justify-end gap-2.5">
              <button onClick={onClose} className="btn btn-outline">
                {t("action.close")}
              </button>
              <button onClick={check} className="btn btn-primary">
                {t("update.retry")}
              </button>
            </div>
          </div>
        )}

        {state.kind === "result" && state.info && (
          <div className="space-y-4">
            {state.info.has_update ? (
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--panel-2)] text-[var(--text)]">
                  <DownloadIcon width={18} height={18} />
                </div>
                <div>
                  <div className="text-[14px] font-semibold">{t("update.downloadNow")}</div>
                  <div className="text-[12px] text-[var(--text-2)]">
                    {state.info.title}
                    {state.info.asset_size ? ` · ${formatBytes(state.info.asset_size)}` : ""}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--panel-2)] text-emerald-400">
                  <CheckIcon width={18} height={18} />
                </div>
                <div>
                  <div className="text-[14px] font-semibold">{t("update.upToDate")}</div>
                  <div className="text-[12px] text-[var(--text-2)]">
                    {t("update.currentVersion")}: v{state.info.current}
                  </div>
                </div>
              </div>
            )}

            {state.info.has_update && (
              <>
                <div className="grid grid-cols-2 gap-3 text-[12.5px]">
                  <div>
                    <div className="text-[var(--muted)]">{t("update.currentVersion")}</div>
                    <div className="mt-0.5 font-semibold tabular-nums">v{state.info.current}</div>
                  </div>
                  <div>
                    <div className="text-[var(--muted)]">{t("update.latestVersion")}</div>
                    <div className="mt-0.5 font-semibold tabular-nums text-[var(--text)]">
                      v{state.info.latest}
                    </div>
                  </div>
                </div>

                {state.info.notes && (
                  <div>
                    <div className="mb-1.5 text-[12.5px] font-semibold text-[var(--text-2)]">
                      {t("update.releaseNotes")}
                    </div>
                    <div className="max-h-44 overflow-y-auto whitespace-pre-line rounded-lg border border-[var(--border)] bg-[var(--bg-2)] p-3 text-[12px] leading-relaxed text-[var(--text-2)]">
                      {state.info.notes}
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap justify-end gap-2.5 pt-1">
                  <button
                    onClick={() => openUrl(state.info!.release_url)}
                    className="btn btn-outline"
                  >
                    <ExternalIcon width={14} height={14} />
                    {t("update.openPage")}
                  </button>
                  <button onClick={downloadUpdate} className="btn btn-primary">
                    <DownloadIcon width={14} height={14} />
                    {t("update.downloadUpdate")}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}