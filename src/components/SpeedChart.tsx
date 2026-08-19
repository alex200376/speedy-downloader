import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatBytes, formatSpeed } from "../api";

interface Point {
  t: number;
  v: number;
}

export default function SpeedChart({ speed }: { speed: number }) {
  const { t } = useTranslation();
  const [points, setPoints] = useState<Point[]>([]);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const now = Date.now();
    setPoints((prev) => [...prev.slice(-59), { t: now, v: speed }]);
  }, [speed]);

  const W = 600;
  const H = 90;
  const maxV = Math.max(...points.map((p) => p.v), 1024 * 64);
  const t0 = points.length ? points[0].t : Date.now();
  const range = Math.max(t0 === Date.now() ? 1 : Date.now() - t0, 1000);

  const path = points
    .map((p, i) => {
      const x = ((p.t - t0) / range) * W;
      const y = H - (p.v / maxV) * (H - 8) - 4;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const area = `${path} L${W},${H} L0,${H} Z`;

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[13px] font-semibold text-[var(--text-2)]">{t("title.speed")}</div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-lg font-bold tabular-nums text-[var(--accent)]">
            {formatSpeed(speed)}
          </span>
        </div>
      </div>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="h-20 w-full" preserveAspectRatio="none">
        <defs>
          <linearGradient id="spd" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.01" />
          </linearGradient>
        </defs>
        {points.length > 1 && (
          <>
            <path d={area} fill="url(#spd)" />
            <path
              d={path}
              fill="none"
              stroke="var(--accent)"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </>
        )}
        {points.length <= 1 && (
          <text x={W / 2} y={H / 2} textAnchor="middle" fill="var(--muted)" fontSize="12">
            {formatBytes(0)}
          </text>
        )}
      </svg>
    </div>
  );
}