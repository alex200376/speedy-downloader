interface Props {
  value: number | null; // 0..1, null = indeterminate
  status: string;
}

export default function ProgressBar({ value, status }: Props) {
  const downloading = status === "Downloading";

  if (value === null || value === undefined || status === "Pending") {
    return (
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--panel-2)]">
        <div className="bar-indeterminate h-full w-1/3 rounded-full bg-[var(--accent)]" />
      </div>
    );
  }

  const pct = Math.min(1, Math.max(0, value));
  const done = pct >= 1;
  const color = done
    ? "var(--green)"
    : status === "Paused"
      ? "var(--amber)"
      : status === "Error"
        ? "var(--rose)"
        : "var(--accent)";

  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--panel-2)]">
      <div
        className={`h-full rounded-full transition-[width] duration-300 ease-out ${
          status === "Queued" || downloading ? "opacity-70" : ""
        }`}
        style={{
          width: `${(pct * 100).toFixed(2)}%`,
          background: color,
        }}
      />
    </div>
  );
}