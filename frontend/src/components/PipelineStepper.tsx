import { Check } from "lucide-react";
import type { Incident } from "../types";

const STEPS = ["Detect", "Explain", "Propose", "Human approval", "Execute", "Verify"] as const;

/** How far along the trusted-action loop the current incident is (0..6 steps complete). */
export function stepsComplete(incident: Incident | null): { done: number; failed: boolean } {
  if (!incident) return { done: 0, failed: false };
  switch (incident.status) {
    case "AWAITING_APPROVAL":
      return { done: 3, failed: false };
    case "IN_PROGRESS":
      return { done: 4, failed: false };
    case "VERIFYING":
      return { done: 5, failed: false };
    case "RESOLVED":
      return { done: 6, failed: false };
    default:
      return { done: 3, failed: true };
  }
}

export function PipelineStepper({ incident }: { incident: Incident | null }) {
  const { done, failed } = stepsComplete(incident);
  return (
    <ol className="grid grid-cols-6 gap-1" aria-label="Trusted action pipeline">
      {STEPS.map((label, i) => {
        const complete = i < done;
        const current = i === done && !failed && incident !== null;
        const stopped = failed && i === done;
        return (
          <li key={label} className="flex flex-col items-center gap-1 text-center" aria-current={current ? "step" : undefined}>
            <div className="flex w-full items-center">
              <div className={`h-px flex-1 ${i === 0 ? "opacity-0" : complete || current ? "bg-accent" : "bg-line"}`} />
              <span
                className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border text-[10px] font-bold ${
                  complete
                    ? "border-accent bg-accent text-bg"
                    : stopped
                      ? "border-crit bg-crit/15 text-crit"
                      : current
                        ? i === 3
                          ? "border-warn bg-warn/15 text-warn motion-safe:animate-pulsering"
                          : "border-accent bg-accent/15 text-accent motion-safe:animate-pulsering"
                        : "border-line text-faint"
                }`}
              >
                {complete ? <Check size={12} strokeWidth={3} /> : i + 1}
              </span>
              <div className={`h-px flex-1 ${i === STEPS.length - 1 ? "opacity-0" : complete ? "bg-accent" : "bg-line"}`} />
            </div>
            <span className={`text-[10.5px] leading-tight ${complete || current ? "text-ink" : "text-faint"} ${i === 3 ? "font-semibold" : ""}`}>
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
