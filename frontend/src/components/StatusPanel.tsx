import { Cpu, Gauge, Power, Wrench } from "lucide-react";
import type { TelemetryFrame } from "../types";
import { fmt } from "../lib/format";
import { Pill, RiskPill } from "./Pill";

const MACHINE_STATE: Record<string, { label: string; tone: "good" | "crit" | "info" }> = {
  RUNNING: { label: "Running", tone: "good" },
  E_STOP: { label: "Emergency stop", tone: "crit" },
  MAINTENANCE: { label: "Maintenance (LOTO)", tone: "info" },
};

const MEDIUM = 0.3;
const CRITICAL = 0.65;

/** Summary card: risk level, computed anomaly score, machine state and current diagnosis. */
export function StatusPanel({ frame }: { frame: TelemetryFrame | null }) {
  if (!frame) {
    return (
      <section className="panel p-4" aria-busy="true">
        <h2 className="panel-title">Machine health</h2>
        <p className="mt-3 text-sm text-muted">Connecting to telemetry stream…</p>
      </section>
    );
  }
  const { detection: d, machine } = frame;
  const score = d.anomaly_score;
  const st = MACHINE_STATE[machine.state];
  const barTone = d.risk === "CRITICAL" ? "bg-crit" : d.risk === "MEDIUM" ? "bg-warn" : "bg-good";

  return (
    <section className="panel p-4" aria-labelledby="health-title">
      <div className="flex items-center justify-between gap-2">
        <h2 id="health-title" className="panel-title">
          Machine health
        </h2>
        <Pill tone={st.tone} size="xs" icon={machine.state === "MAINTENANCE" ? <Wrench size={10} /> : <Power size={10} />}>
          {st.label}
        </Pill>
      </div>

      <div className="mt-3 flex items-end justify-between gap-3">
        <div>
          <div className="text-xs text-muted">Anomaly score</div>
          <div className="num text-4xl font-semibold leading-none tracking-tight" data-testid="anomaly-score">
            {d.risk === "OFFLINE" ? "—" : (score * 100).toFixed(0)}
            <span className="ml-1 text-base font-normal text-faint">/100</span>
          </div>
        </div>
        <RiskPill risk={d.risk} size="lg" />
      </div>

      <div className="relative mt-3 h-2 overflow-hidden rounded-full bg-raised" aria-hidden>
        <div className={`h-full rounded-full transition-all duration-300 ${barTone}`} style={{ width: `${Math.max(1.5, score * 100)}%` }} />
        <div className="absolute inset-y-0 w-px bg-ink/30" style={{ left: `${MEDIUM * 100}%` }} />
        <div className="absolute inset-y-0 w-px bg-ink/30" style={{ left: `${CRITICAL * 100}%` }} />
      </div>
      <div className="num mt-1 flex justify-between text-[10px] text-faint">
        <span>0</span>
        <span style={{ marginLeft: `${MEDIUM * 100 - 8}%` }}>30 medium</span>
        <span>65 critical</span>
        <span>100</span>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-lg border border-line bg-raised/60 p-2.5">
          <dt className="flex items-center gap-1.5 text-xs text-muted">
            <Gauge size={13} aria-hidden /> Shaft speed
          </dt>
          <dd className="num mt-0.5 text-lg font-semibold">
            {fmt(machine.rpm, 0)} <span className="text-xs font-normal text-faint">rpm</span>
          </dd>
        </div>
        <div className="rounded-lg border border-line bg-raised/60 p-2.5">
          <dt className="flex items-center gap-1.5 text-xs text-muted">
            <Cpu size={13} aria-hidden /> Diagnosis
          </dt>
          <dd className="mt-0.5 truncate text-sm font-semibold" title={d.fault?.label}>
            {d.risk === "OFFLINE" ? "Paused" : d.fault ? d.fault.label : "No fault"}
          </dd>
        </div>
      </dl>

      {d.fault && (
        <p className="mt-3 rounded-lg border border-line bg-raised/40 p-2.5 text-xs text-muted">
          <span className="font-semibold text-ink">{d.fault.component_label}</span>
          <br />
          Rule fired: <code className="font-mono text-[11px] text-ink">{d.fault.rule}</code>
        </p>
      )}
    </section>
  );
}
