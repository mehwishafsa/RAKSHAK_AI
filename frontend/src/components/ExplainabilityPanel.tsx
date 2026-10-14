import { Info, Lightbulb } from "lucide-react";
import type { Contribution, Detection, Incident } from "../types";
import { Pill } from "./Pill";

/**
 * "Why" panel: ranked feature contributions from the rule-based detector.
 * Uses the live detection while the machine is running; falls back to the
 * explanation frozen on the incident (what the approver actually saw).
 */
export function ExplainabilityPanel({ detection, incident }: { detection: Detection | null; incident: Incident | null }) {
  const live = detection && detection.risk !== "OFFLINE" && detection.contributions.length > 0;
  const contributions: Contribution[] = live ? detection!.contributions : (incident?.explanation.contributions ?? []);
  const fault = live ? detection!.fault : (incident?.fault ?? null);
  const anyDeviation = contributions.some((c) => c.share > 0);
  const tone = (live ? detection!.risk : incident?.risk) === "CRITICAL" ? "crit" : "warn";

  return (
    <section className="panel flex flex-col p-4" aria-labelledby="xai-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="xai-title" className="panel-title flex items-center gap-1.5">
          <Lightbulb size={13} aria-hidden /> Explainability · why
        </h2>
        <Pill tone="info" size="xs" title="Shares are computed from rule-based per-signal severities. This is not a trained SHAP model.">
          Rule-based contributions · not SHAP
        </Pill>
      </div>

      {!live && !incident && (
        <p className="mt-3 text-sm text-muted">Waiting for detection…</p>
      )}

      {fault && anyDeviation ? (
        <div className="mt-3">
          <p className="text-sm leading-snug">
            <span className="font-semibold">{fault.label}</span> suspected on{" "}
            <span className="font-semibold">{fault.component_label}</span>.
          </p>
          <p className="mt-1 text-xs text-muted">
            Rule: <code className="font-mono text-[11px] text-ink">{fault.rule}</code>
          </p>
        </div>
      ) : (
        (live || incident) && (
          <p className="mt-3 text-sm text-muted">
            No anomalous contribution — every signal is within 3σ of its commissioning baseline.
          </p>
        )
      )}

      <ol className="mt-3 space-y-2.5" aria-label="Ranked signal contributions">
        {contributions.map((c, i) => (
          <li key={c.key} data-testid="contribution">
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className={`font-medium ${c.share > 0 ? "text-ink" : "text-faint"}`}>
                <span className="num mr-1.5 text-faint">{i + 1}.</span>
                {c.label}
              </span>
              <span className="num font-semibold">{(c.share * 100).toFixed(0)}%</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-raised" aria-hidden>
              <div
                className={`h-full rounded-full transition-all duration-300 ${i === 0 && c.share > 0 ? tone === "crit" ? "bg-crit" : "bg-warn" : "bg-info/70"}`}
                style={{ width: `${c.share * 100}%` }}
              />
            </div>
            {c.share > 0 && <p className="mt-1 text-[11.5px] leading-snug text-muted">{c.text}</p>}
          </li>
        ))}
      </ol>

      <p className="mt-auto flex gap-1.5 pt-3 text-[10.5px] leading-snug text-faint">
        <Info size={12} className="mt-px shrink-0" aria-hidden />
        Severity = deviation beyond 3σ of the commissioning baseline, scaled to the trip limit (0–1). Share = a signal's
        severity ÷ total severity. Anomaly score = 1 − Π(1 − severity).
      </p>
    </section>
  );
}
