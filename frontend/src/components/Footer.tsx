import { FlaskConical } from "lucide-react";

export function Footer() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-start gap-x-6 gap-y-2 px-4 py-4 text-xs text-muted">
        <p className="flex max-w-4xl items-start gap-2">
          <FlaskConical size={14} className="mt-px shrink-0 text-warn" aria-hidden />
          <span>
            <span className="font-semibold text-ink">Simulation-driven proof of concept.</span> Sensor data is simulated and not
            connected to physical equipment. Detection, fault classification and explanations are real computations on that
            data using documented rules (EWMA, baseline z-scores, limit-based severity) — no trained ML model is used in this
            loop, and no accuracy figures are claimed. Approvals and the trust ledger are real and persisted.
          </span>
        </p>
        <p className="ml-auto flex gap-3">
          <a className="underline-offset-2 hover:text-ink hover:underline" href="/docs" target="_blank" rel="noreferrer">
            API docs
          </a>
          <span>Rakshak AI · Tata Technologies InnoVent POC</span>
        </p>
      </div>
    </footer>
  );
}
