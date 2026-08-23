import { useTranslation } from "react-i18next";
import { useFilteredTasks, useTaskStats } from "../store/taskStore";
import TaskItem from "./TaskItem";
import SpeedChart from "./SpeedChart";
import { DownloadIcon } from "./icons";

export default function TaskList() {
  const { t } = useTranslation();
  const tasks = useFilteredTasks();
  const stats = useTaskStats();

  if (tasks.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 py-10 sm:py-20 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--panel-2)] text-[var(--muted)]">
          <DownloadIcon width={26} height={26} />
        </div>
        <div className="mt-2 text-[15px] font-semibold">{t("empty.title")}</div>
        <div className="max-w-sm text-[13px] leading-relaxed text-[var(--muted)]">
          {t("empty.hint")}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3 sm:px-6 sm:py-5">
      {stats.activeSpeed > 0 && <SpeedChart speed={stats.activeSpeed} />}
      {tasks.map((task) => (
        <TaskItem key={task.id} task={task} />
      ))}
    </div>
  );
}