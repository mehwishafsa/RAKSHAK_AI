import { useEffect, useState } from "react";
import {
  CheckCircle2,
  ClipboardList,
  Clock,
  Lock,
  Package,
  ShieldCheck,
  ShieldX,
  Users,
  Wrench,
  XCircle,
} from "lucide-react";
import { api } from "../lib/api";
import { STATUS_LABEL, timeOf } from "../lib/format";
import type { Incident } from "../types";
import { Pill, RiskPill } from "./Pill";
import { PipelineStepper } from "./PipelineStepper";

const APPROVER_KEY = "rakshak.approver";

function loadApprover(): string {
  try {
    return localStorage.getItem(APPROVER_KEY) || "Shift Engineer";
  } catch {
    return "Shift Engineer";
  }
}

const STATUS_TONE = {
  AWAITING_APPROVAL: "warn",
  IN_PROGRESS: "info",
  VERIFYING: "info",
  RESOLVED: "good",
  REJECTED: "crit",
  CANCELLED: "faint",
  INTERRUPTED: "faint",
} as const;

export function ActionPanel({ incident, onDecision }: { incident: Incident | null; onDecision?: () => void }) {
  const [approver, setApprover] = useState(loadApprover);
  const [note, setNote] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRejecting(false);
    setReason("");
    setNote("");
    setError(null);
  }, [incident?.id]);

  const remember = (name: string) => {
    try {
      localStorage.setItem(APPROVER_KEY, name);
    } catch {
      /* storage unavailable */
    }
  };

  const decide = async (kind: "approve" | "reject") => {
    if (!incident) return;
    setBusy(true);
    setError(null);
    try {
      if (kind === "approve") await api.approve(incident.id, approver.trim(), note.trim());
      else await api.reject(incident.id, approver.trim(), reason.trim());
      remember(approver.trim());
      onDecision?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  };

  if (!incident) {
    return (
      <section id="action-panel" className="panel p-4" aria-labelledby="action-title">
        <h2 id="action-title" className="panel-title flex items-center gap-1.5">
          <ShieldCheck size={13} aria-hidden /> Trusted action · human approval gate
        </h2>
        <div className="mt-4">
          <PipelineStepper incident={null} />
        </div>
        <p className="mt-4 text-sm text-muted">
          No open incident. When a fault is detected, Rakshak AI proposes a structured maintenance action here. Nothing is
          executed (no shutdown, no parts reserved, no work order) until a named engineer approves it.
        </p>
      </section>
    );
  }

  const a = incident.action;
  const awaiting = incident.status === "AWAITING_APPROVAL";
  const canSubmit = approver.trim().length > 0 && !busy;

  return (
    <section
      id="action-panel"
      className={`panel p-4 transition-shadow ${awaiting ? "border-warn/60 shadow-[0_0_0_1px_rgb(var(--warn)/0.35),0_0_32px_-8px_rgb(var(--warn)/0.45)]" : ""}`}
      aria-labelledby="action-title"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="action-title" className="panel-title flex items-center gap-1.5">
          <ShieldCheck size={13} aria-hidden /> Trusted action · human approval gate
        </h2>
        <div className="flex items-center gap-2">
          <span className="num text-xs text-muted">{incident.id}</span>
          <RiskPill risk={incident.risk} size="xs" />
          <Pill tone={STATUS_TONE[incident.status]} size="xs">
            {STATUS_LABEL[incident.status]}
          </Pill>
        </div>
      </div>

      <div className="mt-4">
        <PipelineStepper incident={incident} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.25fr_1fr]">
        <div>
          <p className="text-[11px] uppercase tracking-wider text-faint">Proposed action · {a.source}</p>
          <h3 className="mt-0.5 text-base font-semibold leading-snug">{a.title}</h3>
          <p className="mt-0.5 text-xs text-muted">
            Target: <span className="text-ink">{a.component_label}</span> · for {incident.fault.label.toLowerCase()}
          </p>
          <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
            <div className="rounded-lg border border-line bg-raised/60 p-2">
              <dt className="flex items-center gap-1 text-faint">
                <Clock size={12} aria-hidden /> Est. time
              </dt>
              <dd className="num mt-0.5 text-sm font-semibold">{a.est_hours} h</dd>
            </div>
            <div className="rounded-lg border border-line bg-raised/60 p-2">
              <dt className="flex items-center gap-1 text-faint">
                <Users size={12} aria-hidden /> Crew
              </dt>
              <dd className="num mt-0.5 text-sm font-semibold">{a.technicians} technicians</dd>
            </div>
            <div className="rounded-lg border border-line bg-raised/60 p-2">
              <dt className="flex items-center gap-1 text-faint">
                <Wrench size={12} aria-hidden /> Priority
              </dt>
              <dd className="mt-0.5 text-sm font-semibold">{a.priority}</dd>
            </div>
          </dl>
          <p className="mt-2 text-xs text-muted">{a.window} · Skills: {a.skills.join(", ")}</p>
          <ol className="mt-3 space-y-1 text-xs text-muted">
            {a.steps.map((s, i) => (
              <li key={s} className="flex gap-2">
                <span className="num text-faint">{i + 1}.</span>
                {s}
              </li>
            ))}
          </ol>
        </div>

        <div>
          <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-faint">
            <Package size={12} aria-hidden /> Inventory check
            {a.inventory.lines.length > 0 &&
              (a.inventory.all_available ? (
                <Pill tone="good" size="xs">
                  All in stock
                </Pill>
              ) : (
                <Pill tone="crit" size="xs">
                  Shortfall
                </Pill>
              ))}
          </p>
          {a.inventory.lines.length === 0 ? (
            <p className="mt-2 text-xs text-muted">No parts required.</p>
          ) : (
            <table className="mt-2 w-full text-xs">
              <thead>
                <tr className="text-left text-faint">
                  <th className="pb-1 font-medium">Part</th>
                  <th className="pb-1 text-right font-medium">Need</th>
                  <th className="pb-1 text-right font-medium">Stock</th>
                </tr>
              </thead>
              <tbody>
                {a.inventory.lines.map((l) => (
                  <tr key={l.sku} className="border-t border-line/70 align-top">
                    <td className="py-1.5 pr-2">
                      <div className="font-medium">{l.name}</div>
                      <div className="num text-[10.5px] text-faint">
                        {l.sku} · {l.location}
                      </div>
                      {l.reorder_after_use && <div className="text-[10.5px] text-warn">Below reorder level after use</div>}
                    </td>
                    <td className="num py-1.5 text-right">
                      {l.required} {l.unit}
                    </td>
                    <td className={`num py-1.5 text-right ${l.available ? "text-good" : "text-crit"}`}>
                      {l.on_hand}
                      {!l.available && <div className="text-[10.5px]">short {l.shortfall}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ---------------- Approval gate ---------------- */}
      <div className="mt-4 rounded-xl border border-line bg-raised/50 p-3.5">
        {awaiting ? (
          <>
            <p className="flex items-start gap-2 text-sm">
              <Lock size={16} className="mt-0.5 shrink-0 text-warn" aria-hidden />
              <span>
                <span className="font-semibold">Locked until a human approves.</span>{" "}
                <span className="text-muted">
                  Approving dispatches a work order, reserves parts and triggers a controlled shutdown. Rejecting logs your
                  reason; the system re-alerts if risk escalates.
                </span>
              </span>
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <label className="text-xs text-muted">
                Approver (name / ID)
                <input
                  className="mt-1 w-full rounded-lg border border-line bg-surface px-2.5 py-2 text-sm text-ink"
                  value={approver}
                  onChange={(e) => setApprover(e.target.value)}
                  maxLength={80}
                />
              </label>
              {rejecting ? (
                <label className="text-xs text-muted">
                  Reason for rejection (required)
                  <input
                    className="mt-1 w-full rounded-lg border border-crit/50 bg-surface px-2.5 py-2 text-sm text-ink"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="e.g. Verified on site, sensor cable loose"
                    maxLength={500}
                    autoFocus
                  />
                </label>
              ) : (
                <label className="text-xs text-muted">
                  Note (optional)
                  <input
                    className="mt-1 w-full rounded-lg border border-line bg-surface px-2.5 py-2 text-sm text-ink"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="e.g. Crew B on standby"
                    maxLength={500}
                  />
                </label>
              )}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {rejecting ? (
                <>
                  <button
                    className="btn border-crit bg-crit text-white hover:bg-crit/90"
                    disabled={!canSubmit || !reason.trim()}
                    onClick={() => decide("reject")}
                  >
                    <ShieldX size={16} aria-hidden /> Confirm rejection
                  </button>
                  <button className="btn btn-ghost" onClick={() => setRejecting(false)} disabled={busy}>
                    Back
                  </button>
                </>
              ) : (
                <>
                  <button
                    className="btn min-w-[180px] border-good bg-good px-5 py-2.5 text-base font-semibold text-white hover:bg-good/90"
                    disabled={!canSubmit}
                    onClick={() => decide("approve")}
                  >
                    <ShieldCheck size={18} aria-hidden /> Approve action
                  </button>
                  <button className="btn btn-ghost px-4 py-2.5" disabled={busy} onClick={() => setRejecting(true)}>
                    <XCircle size={16} aria-hidden /> Reject
                  </button>
                </>
              )}
            </div>
          </>
        ) : (
          <DecisionSummary incident={incident} />
        )}
        {error && (
          <p role="alert" className="mt-2 text-sm text-crit">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}

function DecisionSummary({ incident }: { incident: Incident }) {
  const s = incident.status;
  if (s === "REJECTED") {
    return (
      <p className="flex items-start gap-2 text-sm">
        <XCircle size={16} className="mt-0.5 shrink-0 text-crit" aria-hidden />
        <span>
          Rejected by <span className="font-semibold">{incident.decided_by}</span>
          {incident.decided_at && <> at {timeOf(incident.decided_at)}</>} — “{incident.decision_note}”. No action executed.
        </span>
      </p>
    );
  }
  if (s === "CANCELLED" || s === "INTERRUPTED") {
    return <p className="text-sm text-muted">Incident {s.toLowerCase()} (simulation reset or service restart). No action executed.</p>;
  }
  return (
    <div className="space-y-1.5 text-sm">
      <p className="flex items-start gap-2">
        <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-good" aria-hidden />
        <span>
          Approved by <span className="font-semibold">{incident.decided_by}</span>
          {incident.decided_at && <> at {timeOf(incident.decided_at)}</>}
          {incident.decision_note && <> — “{incident.decision_note}”</>}
        </span>
      </p>
      <p className="flex items-start gap-2 text-muted">
        <ClipboardList size={16} className="mt-0.5 shrink-0" aria-hidden />
        <span>
          Work order <span className="num font-semibold text-ink">{incident.work_order}</span>
          {s === "IN_PROGRESS" && " — crew on site (simulated), machine locked out"}
          {s === "VERIFYING" && " — repair complete, verifying signals against baseline"}
          {s === "RESOLVED" && " — closed"}
        </span>
      </p>
      {incident.outcome && (
        <p className="flex items-start gap-2 text-good">
          <ShieldCheck size={16} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            Outcome verified: risk LOW for {incident.outcome.windows} consecutive windows · post-repair anomaly score{" "}
            <span className="num font-semibold">{(incident.outcome.post_repair_anomaly_score * 100).toFixed(0)}/100</span>
          </span>
        </p>
      )}
    </div>
  );
}
