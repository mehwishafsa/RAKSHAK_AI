import { Activity, Droplets, Gauge, Thermometer } from "lucide-react";
import type { HistoryPoint } from "../hooks/useTelemetry";
import type { SignalKey, TelemetryFrame } from "../types";
import { SIGNAL_META, fmt } from "../lib/format";
import { Pill } from "./Pill";
import { Sparkline } from "./Sparkline";

const CARDS: { key: SignalKey; icon: typeof Activity; secondary?: SignalKey }[] = [
  { key: "vibration_rms", icon: Activity, secondary: "kurtosis" },
  { key: "temperature", icon: Thermometer },
  { key: "pressure", icon: Gauge },
  { key: "oil_quality", icon: Droplets },
];

const LIMIT_TONE = { NORMAL: "good", ALARM: "warn", TRIP: "crit" } as const;
const LIMIT_LABEL = { NORMAL: "Normal", ALARM: "Alarm", TRIP: "Trip" } as const;

export function SensorCards({ frame, history }: { frame: TelemetryFrame | null; history: HistoryPoint[] }) {
  return (
    <section aria-label="Live sensor readings" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {CARDS.map(({ key, icon: Icon, secondary }) => {
        const meta = SIGNAL_META[key];
        const sig = frame?.detection.signals[key];
        const value = frame?.readings[key];
        const values = history.map((h) => h.values[key]);
        const limit = sig?.limit_state ?? "NORMAL";
        const offline = frame?.detection.risk === "OFFLINE";
        const stroke = limit === "TRIP" ? "rgb(var(--crit))" : limit === "ALARM" ? "rgb(var(--warn))" : "rgb(var(--accent))";
        return (
          <article key={key} className="panel p-3.5" aria-label={meta.label}>
            <div className="flex items-start justify-between gap-2">
              <h3 className="flex items-center gap-1.5 text-xs font-medium text-muted">
                <Icon size={14} aria-hidden /> {meta.label}
              </h3>
              {offline ? (
                <Pill tone="faint" size="xs">
                  Paused
                </Pill>
              ) : (
                <Pill tone={LIMIT_TONE[limit]} size="xs">
                  {LIMIT_LABEL[limit]}
                </Pill>
              )}
            </div>
            <div className="mt-1.5 flex items-baseline gap-1.5">
              <span className="num text-2xl font-semibold tracking-tight" data-testid={`reading-${key}`}>
                {fmt(value, meta.decimals)}
              </span>
              <span className="text-xs text-faint">{meta.unit}</span>
              {sig && !offline && (
                <span className={`num ml-auto text-xs ${Math.abs(sig.z_score) > 3 ? "text-ink" : "text-faint"}`} title="Smoothed deviation from commissioning baseline, in baseline standard deviations">
                  {sig.z_score >= 0 ? "+" : ""}
                  {sig.z_score.toFixed(1)}σ
                </span>
              )}
            </div>
            <div className="mt-2">
              <Sparkline
                values={values}
                baseline={sig?.baseline}
                alarm={sig?.alarm}
                trip={sig?.trip}
                decimals={meta.decimals}
                unit={meta.unit}
                label={meta.label}
                stroke={stroke}
              />
            </div>
            <div className="num mt-1.5 flex flex-wrap justify-between gap-x-2 text-[10.5px] text-faint">
              <span>base {fmt(sig?.baseline, meta.decimals)}</span>
              <span className="text-warn/90">alarm {sig ? sig.alarm : "—"}</span>
              <span className="text-crit/90">trip {sig ? sig.trip : "—"}</span>
              {secondary && frame && (
                <span className="w-full text-muted">
                  kurtosis {fmt(frame.readings.kurtosis, 2)} · crest {fmt(frame.readings.crest_factor, 2)}
                </span>
              )}
            </div>
          </article>
        );
      })}
    </section>
  );
}
