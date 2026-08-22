import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatBytes, formatEta, formatSpeed, fileIcon, openFolder, backendErrorKey } from "../api";
import { useTaskStore } from "../store/taskStore";
import { useToastStore } from "../store/toastStore";
import type { DownloadTask } from "../types";
import ProgressBar from "./ProgressBar";
import VerifyHashDialog from "./VerifyHashDialog";
import {
  PauseIcon,
  PlayIcon,
  XIcon,
  TrashIcon,
  FolderIcon,
  RetryIcon,
  AlertIcon,
  CheckIcon,
  ClockIcon,
  ShieldIcon,
  FileGlyph,
} from "./icons";

const STATUS_STYLE: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
  Pending: {
    label: "status.Pending",
    cls: "bg-sky-500/10 text-sky-400 border-sky-500/30",
    icon: <ClockIcon width={12} height={12} />,
  },
  Queued: {
    label: "status.Queued",
    cls: "bg-zinc-500/10 text-zinc-400 border-zinc-500/30",
    icon: <ClockIcon width={12} height={12} />,
  },
  Downloading: {
    label: "status.Downloading",
    cls: "bg-sky-500/10 text-sky-400 border-sky-500/30",
    icon: <ClockIcon width={12} height={12} />,
  },
  Paused: {
    label: "status.Paused",
    cls: "bg-amber-500/10 text-amber-400 border-amber-500/30",
    icon: <PauseIcon width={12} height={12} />,
  },
  Completed: {
    label: "status.Completed",
    cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
    icon: <CheckIcon width={12} height={12} />,
  },
  Error: {
    label: "status.Error",
    cls: "bg-rose-500/10 text-rose-400 border-rose-500/30",
    icon: <AlertIcon width={12} height={12} />,
  },
  Canceled: {
    label: "status.Canceled",
    cls: "bg-zinc-500/10 text-zinc-400 border-zinc-500/30",
    icon: <XIcon width={12} height={12} />,
  },
};

interface Props {
  task: DownloadTask;
}

export default function TaskItem({ task }: Props) {
  const { t } = useTranslation();
  const { pauseTask, resumeTask, cancelTask, removeTask } = useTaskStore();
  const refreshedAt = useTaskStore((s) => s.refreshedAt);
  const toast = useToastStore((s) => s.push);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [showVerify, setShowVerify] = useState(false);

  const icon = fileIcon(task.filename);
  const st = STATUS_STYLE[task.status] ?? STATUS_STYLE.Queued;
  const live = useLiveProgress(task, refreshedAt);
  const totalSize = task.total_size && task.total_size > 0 ? task.total_size : null;
  const downloaded = Number.isFinite(live.downloaded) && live.downloaded > 0 ? live.downloaded : 0;
  const speed = Number.isFinite(live.speed) && live.speed > 0 ? live.speed : 0;
  const progress = totalSize ? downloaded / totalSize : null;
  const remaining = totalSize ? Math.max(0, totalSize - downloaded) : 0;

  const handlePause = async () => {
    const ok = await pauseTask(task.id);
    if (ok) toast("success", t("toast.paused"));
  };
  const handleResume = async () => {
    const ok = await resumeTask(task.id);
    if (ok) toast("success", t("toast.resumed"));
  };
  const handleCancel = async () => {
    const ok = await cancelTask(task.id);
    if (ok) toast("info", t("toast.canceled"));
  };
  const handleRemove = async () => {
    if (!confirmRemove) {
      setConfirmRemove(true);
      setTimeout(() => setConfirmRemove(false), 2500);
      return;
    }
    const ok = await removeTask(task.id);
    if (ok) toast("info", t("toast.removed"));
  };
  const handleOpen = async () => {
    if (!(await openFolder(task.file_path))) toast("error", t("toast.error"));
  };
  const active = task.status === "Downloading";

  return (
    <div className="group animate-slide-in rounded-lg border border-[var(--border)] bg-[var(--panel)] p-2.5 sm:p-3.5 transition hover:border-[var(--text-2)]/40 hover:bg-[var(--panel-2)]/60">
      <div className="flex items-start gap-3.5">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${icon.color}`}
        >
          <FileGlyph kind={icon.kind} width={20} height={20} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[14px] font-semibold">{task.filename}</span>
            {task.kind === "video" && (
              <span className="shrink-0 rounded border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-violet-400">
                VIDEO
              </span>
            )}
            <span
              className={`flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium ${st.cls}`}
            >
              {st.icon}
              {t(st.label)}
            </span>
          </div>

          <div className="mt-0.5 truncate text-[12px] text-[var(--muted)]">{task.url}</div>

          <div className="mt-2.5">
            <ProgressBar value={progress} status={task.status} />
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-[var(--text-2)]">
            <span className="tabular-nums">
              {formatBytes(downloaded)}
              {totalSize ? ` / ${formatBytes(totalSize)}` : ""}
            </span>
            {progress !== null && (
              <span className="font-semibold tabular-nums text-[var(--text-2)]">
                {(progress * 100).toFixed(1)}%
              </span>
            )}
            {active && (
              <span className="font-semibold tabular-nums text-[var(--accent)]">
                {formatSpeed(speed)}
              </span>
            )}
            {active && totalSize && (
              <span className="tabular-nums">
                {t("title.eta")} {formatEta(remaining, speed)}
              </span>
            )}
{task.status !== "Completed" && task.kind !== "video" && (
  <span className="tabular-nums text-[var(--muted)]">
    {t("task.segments", { n: task.segments })}
  </span>
)}
            {task.status === "Error" && task.error && (
              <span className="truncate text-rose-400">
                {backendErrorKey(task.error) ? t(backendErrorKey(task.error)!) : task.error}
              </span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1 opacity-100 sm:opacity-0 sm:transition sm:group-hover:opacity-100">
          {task.status === "Downloading" || task.status === "Queued" ? (
            task.kind === "video" ? null : (
              <IconBtn title={t("action.pause")} onClick={handlePause}>
                <PauseIcon width={15} height={15} />
              </IconBtn>
            )
          ) : task.status === "Paused" || task.status === "Error" ? (
            <IconBtn title={t("action.resume")} onClick={handleResume} accent>
              <PlayIcon width={15} height={15} />
            </IconBtn>
          ) : null}
          {task.status === "Downloading" && task.kind !== "video" && (
            <IconBtn title={t("action.cancel")} onClick={handleCancel} danger>
              <XIcon width={15} height={15} />
            </IconBtn>
          )}
          {task.status === "Downloading" && task.kind === "video" && (
            <IconBtn title={t("action.cancel")} onClick={handleCancel} danger>
              <XIcon width={15} height={15} />
            </IconBtn>
          )}
          {task.status === "Error" && (
            <IconBtn title={t("action.retry")} onClick={handleResume}>
              <RetryIcon width={15} height={15} />
            </IconBtn>
          )}
          <IconBtn title={t("action.openFolder")} onClick={handleOpen}>
            <FolderIcon width={15} height={15} />
          </IconBtn>
          {task.status === "Completed" && (
            <IconBtn title={t("action.verify")} onClick={() => setShowVerify(true)}>
              <ShieldIcon width={15} height={15} />
            </IconBtn>
          )}
          <IconBtn
            title={t("action.remove")}
            onClick={handleRemove}
            danger={confirmRemove}
            pulse={confirmRemove}
          >
            <TrashIcon width={15} height={15} />
          </IconBtn>
        </div>
      </div>
      <VerifyHashDialog
        open={showVerify}
        taskId={task.id}
        filename={task.filename}
        onClose={() => setShowVerify(false)}
      />
    </div>
  );
}

function useLiveProgress(task: DownloadTask, refreshedAt: number) {
  const [now, setNow] = useState(() => Date.now());
  const active = task.status === "Downloading";

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [active]);

  // Always start from the latest backend-reported values.
  const base = task.total_size
    ? Math.min(task.total_size, task.downloaded)
    : task.downloaded;

  let value = base;

  // Smoothly extrapolate forward between backend events so the bar appears
  // to move continuously. Use time-based progress when speed is unavailable
  // to handle cases where speed measurement lags or is temporarily zero.
  if (active && task.total_size) {
    const elapsed = (now - refreshedAt) / 1000;
    if (elapsed > 0 && elapsed <= 5) {
      // Extrapolate based on speed if available and positive
      if (task.speed > 0) {
        value = Math.min(task.total_size, base + task.speed * elapsed);
      }
      // If speed is 0 or unavailable, still update based on downloaded value
      // This handles cases where speed measurement is delayed but download progresses
    }
  }

  // Never exceed total_size
  if (task.total_size) {
    value = Math.min(task.total_size, value);
  }

  return { downloaded: value, speed: task.speed };
}

function IconBtn({
  children,
  onClick,
  title,
  danger,
  accent,
  pulse,
}: {
  children: ReactNode;
  onClick: () => void;
  title: string;
  danger?: boolean;
  accent?: boolean;
  pulse?: boolean;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`icon-btn ${
        danger ? "icon-btn-danger" : accent ? "icon-btn-accent" : ""
      } ${pulse ? "animate-pulse" : ""}`}
    >
      {children}
    </button>
  );
}