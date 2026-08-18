import { useTranslation } from "react-i18next";
import { useFilteredTasks, useTaskStats } from "../store/taskStore";
import TaskItem from "./TaskItem";
import SpeedChart from "./SpeedChart";
import { DownloadIcon } from "./icons";

interface Props {
  onNew: () => void;
}

export default function TaskList({ onNew }: Props) {
  const { t } = useTranslation();
  const tasks = useFilteredTasks();
  const stats = useTaskStats();

  if (tasks.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 py-20 text-center">
        <div className="app-gradient flex h-16 w-16 items-center justify-center rounded-2xl text-white/90 shadow-xl shadow-indigo-500/25">
          <DownloadIcon width={30} height={30} />
        </div>
        <div className="mt-2 text-[15px] font-semibold">{t("empty.title")}</div>
        <div className="max-w-sm text-[13px] leading-relaxed text-[var(--muted)]">
          {t("empty.hint")}
        </div>
        <button
          onClick={onNew}
          className="app-gradient mt-3 rounded-xl px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition hover:brightness-110 active:scale-95"
        >
          {t("header.newDownload")}
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
      {stats.activeSpeed > 0 && <SpeedChart speed={stats.activeSpeed} />}
      {tasks.map((task) => (
        <TaskItem key={task.id} task={task} />
      ))}
    </div>
  );
}