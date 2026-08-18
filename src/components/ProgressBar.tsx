interface Props {
  value: number | null; // 0..1, null = indeterminate
  status: string;
}

export default function ProgressBar({ value, status }: Props) {
  const downloading = status === "Downloading";

  if (value === null || value === undefined || status === "Pending") {
    return <div className="bar-shimmer h-1.5 w-full overflow-hidden rounded-full" />;
  }

  const pct = Math.min(1, Math.max(0, value));
  const done = pct >= 1;
  const color = done
    ? "var(--green)"
    : status === "Paused"
      ? "var(--amber)"
      : status === "Error"
        ? "var(--rose)"
        : undefined;

  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--panel-2)]">
      <div
        className={`relative h-full rounded-full transition-[width] duration-300 ease-out ${
          status === "Queued" ? "bar-queued" : ""
        }`}
        style={{
          width: `${(pct * 100).toFixed(2)}%`,
          background: color ?? "linear-gradient(90deg, var(--accent), var(--accent-2))",
        }}
      >
        {downloading && !done && <div className="bar-striped absolute inset-0 rounded-full" />}
      </div>
    </div>
  );
}