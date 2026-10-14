import { useId, useMemo, useState } from "react";

export interface SparkProps {
  values: number[];
  baseline?: number;
  alarm?: number;
  trip?: number;
  decimals: number;
  unit: string;
  height?: number;
  label: string;
  stroke?: string;
}

const W = 300;

/** Lightweight live SVG line chart with baseline / alarm / trip reference lines and a hover readout. */
export function Sparkline({ values, baseline, alarm, trip, decimals, unit, height = 64, label, stroke = "rgb(var(--accent))" }: SparkProps) {
  const [hover, setHover] = useState<number | null>(null);
  const gid = useId();
  const H = height;

  const { path, area, y, n } = useMemo(() => {
    const refs = [baseline, alarm].filter((v): v is number => v !== undefined);
    const all = values.concat(refs);
    let lo = Math.min(...all);
    let hi = Math.max(...all);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
      lo = 0;
      hi = 1;
    }
    const pad = (hi - lo || Math.abs(hi) || 1) * 0.12;
    lo -= pad;
    hi += pad;
    const n = Math.max(values.length, 2);
    const x = (i: number) => (i / (n - 1)) * W;
    const y = (v: number) => H - 2 - ((v - lo) / (hi - lo)) * (H - 4);
    const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    const path = pts.length ? `M${pts.join("L")}` : "";
    const area = pts.length ? `${path}L${x(values.length - 1).toFixed(1)},${H}L0,${H}Z` : "";
    return { path, area, y, n };
  }, [values, baseline, alarm, H]);

  const ref = (v: number | undefined, color: string, dash: string, name: string) =>
    v === undefined || y(v) < 0 || y(v) > H ? null : (
      <g>
        <line x1={0} x2={W} y1={y(v)} y2={y(v)} stroke={color} strokeWidth={1} strokeDasharray={dash} vectorEffect="non-scaling-stroke" />
        <title>{`${name}: ${v.toFixed(decimals)} ${unit}`}</title>
      </g>
    );

  const hv = hover !== null ? values[hover] : undefined;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="block h-16 w-full touch-none"
        role="img"
        aria-label={`${label} trend, last ${values.length} samples`}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const i = Math.round(((e.clientX - r.left) / r.width) * (n - 1));
          setHover(i >= 0 && i < values.length ? i : null);
        }}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity={0.22} />
            <stop offset="100%" stopColor={stroke} stopOpacity={0} />
          </linearGradient>
        </defs>
        {ref(baseline, "rgb(var(--faint))", "2 3", "Baseline")}
        {ref(alarm, "rgb(var(--warn))", "5 4", "Alarm limit")}
        {ref(trip, "rgb(var(--crit))", "5 4", "Trip limit")}
        <path d={area} fill={`url(#${gid})`} />
        <path d={path} fill="none" stroke={stroke} strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {hover !== null && hv !== undefined && (
          <>
            <line x1={(hover / (n - 1)) * W} x2={(hover / (n - 1)) * W} y1={0} y2={H} stroke="rgb(var(--muted))" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          </>
        )}
      </svg>
      {hover !== null && hv !== undefined && (
        <div
          className="num pointer-events-none absolute -top-7 rounded border border-line bg-raised px-1.5 py-0.5 text-[11px] text-ink shadow"
          style={{ left: `clamp(0px, calc(${(hover / (n - 1)) * 100}% - 32px), calc(100% - 72px))` }}
        >
          {hv.toFixed(decimals)} {unit}
          <span className="ml-1 text-faint">{((values.length - 1 - hover) * 0.2).toFixed(1)}s ago</span>
        </div>
      )}
    </div>
  );
}
