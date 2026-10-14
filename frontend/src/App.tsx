import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowDown, X } from "lucide-react";
import { ActionPanel } from "./components/ActionPanel";
import { DemoControls } from "./components/DemoControls";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ExplainabilityPanel } from "./components/ExplainabilityPanel";
import { Footer } from "./components/Footer";
import { RiskPill } from "./components/Pill";
import { SensorCards } from "./components/SensorCards";
import { StatusPanel } from "./components/StatusPanel";
import { TopBar } from "./components/TopBar";
import { TrustLedger } from "./components/TrustLedger";
import { WaveformScope } from "./components/WaveformScope";
import { usePrefersReducedMotion } from "./hooks/usePrefersReducedMotion";
import { useTelemetry } from "./hooks/useTelemetry";
import { api } from "./lib/api";
import type { LedgerEntry } from "./types";

const DigitalTwin = lazy(() => import("./twin/DigitalTwin"));

type Theme = "dark" | "light";

function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem("rakshak.theme");
    if (saved === "dark" || saved === "light") return saved;
  } catch {
    /* ignore */
  }
  return "dark";
}

const STATE_CAPTION: Record<string, string> = {
  RUNNING: "Running",
  E_STOP: "Emergency stop — coasting to standstill",
  MAINTENANCE: "Locked out for maintenance",
};

export default function App() {
  const { frame, history, status } = useTelemetry();
  const reducedMotion = usePrefersReducedMotion();
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [ledgerLoading, setLedgerLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const lastLedgerCount = useRef(-1);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("rakshak.theme", theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  const refreshLedger = useCallback(async () => {
    try {
      setLedger(await api.ledger(300));
    } catch {
      /* transient; next ledger_head change retries */
    } finally {
      setLedgerLoading(false);
    }
  }, []);

  // Refetch the ledger whenever the server reports a new head.
  const ledgerCount = frame?.ledger_head.count ?? -1;
  useEffect(() => {
    if (ledgerCount !== lastLedgerCount.current) {
      lastLedgerCount.current = ledgerCount;
      void refreshLedger();
    }
  }, [ledgerCount, refreshLedger]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(t);
  }, [toast]);

  const incident = frame?.incident ?? null;
  const awaiting = incident?.status === "AWAITING_APPROVAL";
  const risk = frame?.detection.risk ?? "LOW";

  return (
    <div className="flex min-h-full flex-col">
      <TopBar frame={frame} status={status} theme={theme} onToggleTheme={() => setTheme(theme === "dark" ? "light" : "dark")} />

      {awaiting && incident && (
        <div className="sticky top-[57px] z-20 border-b border-warn/40 bg-warn/15 backdrop-blur" role="alert">
          <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-3 px-4 py-2 text-sm">
            <AlertTriangle size={16} className="text-warn" aria-hidden />
            <span>
              <span className="num font-semibold">{incident.id}</span> · {incident.fault.label} on {incident.fault.component_label} —{" "}
              <span className="font-semibold">awaiting human approval</span>
            </span>
            <button
              className="btn ml-auto border-warn/60 bg-warn/20 py-1 text-xs"
              onClick={() => document.getElementById("action-panel")?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "center" })}
            >
              Review action <ArrowDown size={13} aria-hidden />
            </button>
          </div>
        </div>
      )}

      <main className="mx-auto grid w-full max-w-[1600px] flex-1 grid-cols-1 gap-4 px-4 py-4 lg:grid-cols-12">
        {/* Hero: 3D digital twin */}
        <section
          className="panel relative h-[clamp(420px,60vh,660px)] overflow-hidden lg:col-span-8 lg:h-auto"
          style={{ minHeight: "clamp(420px, 60vh, 660px)", background: "var(--twin-bg)" }}
          aria-label="Digital twin"
        >
          <ErrorBoundary
            fallback={
              <div className="grid h-full place-items-center p-6 text-center text-sm text-muted">
                3D view unavailable on this device (WebGL). All telemetry, detection and approvals continue below.
              </div>
            }
          >
            <Suspense fallback={<div className="grid h-full place-items-center text-sm text-muted">Loading digital twin…</div>}>
              <DigitalTwin frame={frame} reducedMotion={reducedMotion} theme={theme} />
            </Suspense>
          </ErrorBoundary>

          <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-3">
            <div className="pointer-events-auto flex flex-col gap-1.5 rounded-lg border border-white/10 bg-black/45 px-3 py-2 text-white backdrop-blur">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/55">Digital twin · CD-07</div>
              <div className="flex items-center gap-2">
                <RiskPill risk={risk} />
                <span className="text-xs text-white/80">{STATE_CAPTION[frame?.machine.state ?? "RUNNING"]}</span>
              </div>
            </div>
            <div className="pointer-events-auto hidden sm:block">{frame && <WaveformScope samples={frame.waveform} />}</div>
          </div>

          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/40 to-transparent p-3 pt-10">
            <DemoControls frame={frame} onError={setToast} />
            <p className="mt-2 text-[10px] text-white/45">
              Drag to orbit · scroll to zoom · rotation shown ~30× slower than real 1480 rpm · simulated plant
            </p>
          </div>
        </section>

        <div className="flex flex-col gap-4 lg:col-span-4">
          <StatusPanel frame={frame} />
          <ExplainabilityPanel detection={frame?.detection ?? null} incident={incident} />
        </div>

        <div className="lg:col-span-12">
          <SensorCards frame={frame} history={history} />
        </div>

        <div className="lg:col-span-12">
          <ActionPanel incident={incident} onDecision={refreshLedger} />
        </div>

        <div className="lg:col-span-12">
          <TrustLedger entries={ledger} loading={ledgerLoading} />
        </div>
      </main>

      <Footer />

      {toast && (
        <div role="alert" className="fixed bottom-4 right-4 z-50 flex max-w-sm items-start gap-2 rounded-lg border border-crit/50 bg-surface p-3 text-sm shadow-xl">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-crit" aria-hidden />
          <span className="flex-1">{toast}</span>
          <button onClick={() => setToast(null)} aria-label="Dismiss" className="text-faint hover:text-ink">
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
