import { useState } from "react";
import { Droplets, Flame, OctagonX, RotateCcw, Waves } from "lucide-react";
import { api } from "../lib/api";
import type { ScenarioId, TelemetryFrame } from "../types";

const SCENARIOS: { id: ScenarioId; label: string; icon: typeof Waves }[] = [
  { id: "bearing", label: "Bearing fault", icon: Waves },
  { id: "overheating", label: "Overheating", icon: Flame },
  { id: "lubrication", label: "Lubrication fault", icon: Droplets },
];
const SPEEDS = [0.5, 1, 2, 4];

/** Presenter controls. Clearly labelled as simulation: they change the simulated sensor stream, not the detector. */
export function DemoControls({ frame, onError }: { frame: TelemetryFrame | null; onError: (msg: string) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(null);
    }
  };
  const injected = frame?.machine.injected_scenario ?? null;
  const state = frame?.machine.state;

  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="Simulation controls">
      <span className="mr-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/60">Simulate</span>
      {SCENARIOS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          className={`btn border-white/15 bg-black/40 py-1.5 text-xs text-white backdrop-blur hover:border-white/40 ${
            injected === id ? "border-warn/70 bg-warn/20" : ""
          }`}
          disabled={busy !== null || state !== "RUNNING"}
          aria-pressed={injected === id}
          onClick={() => run(id, () => api.injectScenario(id))}
        >
          <Icon size={14} aria-hidden /> {label}
        </button>
      ))}
      <button
        className="btn border-white/15 bg-black/40 py-1.5 text-xs text-white backdrop-blur hover:border-white/40"
        disabled={busy !== null}
        onClick={() => run("reset", api.reset)}
      >
        <RotateCcw size={14} aria-hidden /> Reset to healthy
      </button>
      <div className="flex items-center rounded-lg border border-white/15 bg-black/40 p-0.5 backdrop-blur" role="group" aria-label="Simulation speed">
        {SPEEDS.map((s) => (
          <button
            key={s}
            className={`num rounded-md px-2 py-1 text-[11px] ${frame?.speed === s ? "bg-white/90 font-semibold text-black" : "text-white/75 hover:text-white"}`}
            aria-pressed={frame?.speed === s}
            onClick={() => run(`speed${s}`, () => api.setSpeed(s))}
          >
            {s}×
          </button>
        ))}
      </div>
      <button
        className="btn ml-auto border-crit bg-crit py-1.5 text-xs font-bold uppercase tracking-wide text-white hover:bg-crit/90"
        disabled={busy !== null || state === "E_STOP"}
        onClick={() => run("estop", () => api.emergencyStop("operator"))}
      >
        <OctagonX size={15} aria-hidden /> E-Stop
      </button>
    </div>
  );
}
