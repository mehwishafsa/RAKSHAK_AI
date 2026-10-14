/** Raw vibration window (simulated accelerometer-derived velocity), like an oscilloscope trace. */
export function WaveformScope({ samples }: { samples: number[] }) {
  const W = 220;
  const H = 56;
  const max = Math.max(4, ...samples.map((s) => Math.abs(s)));
  const pts = samples.map((v, i) => `${((i / Math.max(1, samples.length - 1)) * W).toFixed(1)},${(H / 2 - (v / max) * (H / 2 - 2)).toFixed(1)}`);
  return (
    <figure className="rounded-lg border border-white/10 bg-black/45 px-2.5 py-2 backdrop-blur">
      <figcaption className="flex justify-between gap-3 text-[9.5px] uppercase tracking-wider text-white/55">
        <span>Raw vibration window</span>
        <span className="num">±{max.toFixed(1)} mm/s · 78 ms</span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 block h-14 w-[220px]" role="img" aria-label="Live raw vibration waveform">
        <line x1={0} x2={W} y1={H / 2} y2={H / 2} stroke="rgba(255,255,255,0.15)" strokeWidth={1} />
        {pts.length > 1 && <polyline points={pts.join(" ")} fill="none" stroke="#2dd4bf" strokeWidth={1.2} strokeLinejoin="round" />}
      </svg>
    </figure>
  );
}
