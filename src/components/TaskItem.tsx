import type { ReactNode } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { formatBytes, formatEta, formatSpeed, fileIcon, openFolder } from "../api";
import { useTaskStore } from "../store/taskStore";
import { useToastStore } from "../store/toastStore";
import type { DownloadTask } from "../types";
import ProgressBar from "./ProgressBar";
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
} from "./icons";

const STATUS_STYLE: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
  Pending: {
    label: "status.Pending",
    cls: "bg-sky-500/10 text-sky-400 border-sky-500/30",
    icon: <ClockIcon width={12} height={12} />,
  },
  Queued: {
    label: "status.Queued",
    cls: "bg-slate-500/10 text-slate-400 border-slate-500/30",
    icon: <ClockIcon width={12} height={12} />,
  },
  Downloading: {
    label: "status.Downloading",
    cls: "bg-indigo-500/10 text-indigo-400 border-indigo-500/30",
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
    cls: "bg-slate-500/10 text-slate-400 border-slate-500/30",
    icon: <XIcon width={12} height={12} />,
  },
};

interface Props {
  task: DownloadTask;
}

export default function TaskItem({ task }: Props) {
  const { t } = useTranslation();
  const { pauseTask, resumeTask, cancelTask, removeTask } = useTaskStore();
  const toast = useToastStore((s) => s.push);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const icon = fileIcon(task.filename);
  const st = STATUS_STYLE[task.status] ?? STATUS_STYLE.Queued;
  const progress =
    task.total_size && task.total_size > 0 ? task.downloaded / task.total_size : null;
  const remaining =
    task.total_size && task.total_size > 0 ? task.total_size - task.downloaded : 0;

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
    <div className="group animate-slide-in relative rounded-2xl border border-[var(--border-soft)] bg-[var(--panel)] p-4 transition hover:border-[var(--accent)]/40 hover:shadow-[var(--shadow)]">
      <div className="flex items-start gap-3.5">
        <div
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-lg ${icon.color}`}
        >
          {icon.label}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[14px] font-semibold">{task.filename}</span>
            <span
              className={`flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${st.cls}`}
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
              {formatBytes(task.downloaded)}
              {task.total_size ? ` / ${formatBytes(task.total_size)}` : ""}
            </span>
            {active && (
              <span className="font-semibold tabular-nums text-[var(--accent)]">
                {formatSpeed(task.speed)}
              </span>
            )}
            {active && task.total_size && (
              <span className="tabular-nums">
                {t("title.eta")} {formatEta(remaining, task.speed)}
              </span>
            )}
            {task.status !== "Completed" && (
              <span className="tabular-nums text-[var(--muted)]">
                {t("task.segments", { n: task.segments })}
              </span>
            )}
            {task.status === "Error" && task.error && (
              <span className="truncate text-rose-400">{task.error}</span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1 opacity-0 transition group-hover:opacity-100">
          {task.status === "Downloading" || task.status === "Queued" ? (
            <IconBtn title={t("action.pause")} onClick={handlePause}>
              <PauseIcon width={15} height={15} />
            </IconBtn>
          ) : task.status === "Paused" || task.status === "Error" ? (
            <IconBtn title={t("action.resume")} onClick={handleResume} accent>
              <PlayIcon width={15} height={15} />
            </IconBtn>
          ) : null}
          {active && (
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
    </div>
  );
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
      className={`flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border-soft)] bg-[var(--panel-2)] transition active:scale-95 ${
        danger
          ? "text-rose-400 hover:border-rose-500/40 hover:bg-rose-500/10"
          : accent
            ? "text-emerald-400 hover:border-emerald-500/40 hover:bg-emerald-500/10"
            : "text-[var(--text-2)] hover:border-[var(--accent)]/40 hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
      } ${pulse ? "animate-pulse" : ""}`}
    >
      {children}
    </button>
  );
}