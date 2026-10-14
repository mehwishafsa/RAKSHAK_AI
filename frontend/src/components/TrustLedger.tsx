import { Fragment, useMemo, useState } from "react";
import { ChevronRight, Link2, ShieldAlert, ShieldCheck } from "lucide-react";
import { api } from "../lib/api";
import { dateOf, timeOf } from "../lib/format";
import type { LedgerEntry, LedgerVerification } from "../types";
import { Pill, type Tone } from "./Pill";

const EVENT_TONE: Record<string, Tone> = {
  FAULT_DETECTED: "crit",
  RISK_ESCALATED: "crit",
  EMERGENCY_STOP: "crit",
  EXPLANATION_GENERATED: "info",
  FAULT_RECLASSIFIED: "info",
  ACTION_PROPOSED: "accent",
  HUMAN_APPROVED: "good",
  HUMAN_REJECTED: "warn",
  WORK_ORDER_DISPATCHED: "accent",
  MAINTENANCE_COMPLETED: "info",
  OUTCOME_VERIFIED: "good",
};

type Filter = "all" | "incident" | "controls";

export function TrustLedger({ entries, loading }: { entries: LedgerEntry[]; loading: boolean }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<number | null>(null);
  const [verification, setVerification] = useState<LedgerVerification | null>(null);
  const [verifying, setVerifying] = useState(false);

  const rows = useMemo(
    () =>
      entries.filter((e) =>
        filter === "all" ? true : filter === "incident" ? e.incident_id !== null : e.source !== "live",
      ),
    [entries, filter],
  );

  const verify = async () => {
    setVerifying(true);
    try {
      setVerification(await api.verifyLedger());
    } finally {
      setVerifying(false);
    }
  };

  return (
    <section className="panel p-4" aria-labelledby="ledger-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="ledger-title" className="panel-title flex items-center gap-1.5">
            <Link2 size={13} aria-hidden /> Trust ledger · append-only audit trail
          </h2>
          <p className="mt-1 text-xs text-muted">
            Every entry stores the SHA-256 of the previous one; database triggers block edits and deletes. Persisted in SQLite.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-line bg-raised p-0.5 text-xs" role="group" aria-label="Filter ledger">
            {(
              [
                ["all", "All"],
                ["incident", "Incident events"],
                ["controls", "Demo / sample"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setFilter(id)}
                aria-pressed={filter === id}
                className={`rounded-md px-2.5 py-1 ${filter === id ? "bg-surface font-semibold text-ink shadow-sm" : "text-muted hover:text-ink"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <button className="btn btn-ghost py-1.5 text-xs" onClick={verify} disabled={verifying}>
            <ShieldCheck size={14} aria-hidden /> {verifying ? "Verifying…" : "Verify hash chain"}
          </button>
        </div>
      </div>

      {verification && (
        <div
          role="status"
          className={`mt-3 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-xs ${
            verification.valid ? "border-good/40 bg-good/10" : "border-crit/50 bg-crit/10"
          }`}
        >
          {verification.valid ? <ShieldCheck size={14} className="text-good" aria-hidden /> : <ShieldAlert size={14} className="text-crit" aria-hidden />}
          {verification.valid ? (
            <span>
              Chain intact — <span className="num">{verification.checked}</span> entries recomputed. Head{" "}
              <code className="num">{verification.head_hash?.slice(0, 16)}…</code>
            </span>
          ) : (
            <span>
              Chain BROKEN at entry #{verification.broken_at_seq} ({verification.reason})
            </span>
          )}
        </div>
      )}

      <div className="mt-3 max-h-[420px] overflow-auto rounded-lg border border-line">
        <table className="w-full min-w-[760px] text-left text-xs">
          <thead className="sticky top-0 z-10 bg-raised text-faint">
            <tr>
              <th className="w-6 px-2 py-2" />
              <th className="px-2 py-2 font-medium">#</th>
              <th className="px-2 py-2 font-medium">Time</th>
              <th className="px-2 py-2 font-medium">Event</th>
              <th className="px-2 py-2 font-medium">Incident</th>
              <th className="px-2 py-2 font-medium">Actor</th>
              <th className="px-2 py-2 font-medium">Summary</th>
              <th className="px-2 py-2 font-medium">Hash</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => {
              const expanded = open === e.seq;
              const dim = e.source !== "live";
              return (
                <Fragment key={e.seq}>
                  <tr
                    className={`cursor-pointer border-t border-line/70 align-top hover:bg-raised/60 ${dim ? "text-muted" : ""}`}
                    onClick={() => setOpen(expanded ? null : e.seq)}
                    data-testid="ledger-row"
                  >
                    <td className="px-2 py-2">
                      <button aria-label={expanded ? "Collapse entry" : "Expand entry"} aria-expanded={expanded} className="text-faint">
                        <ChevronRight size={14} className={`transition-transform ${expanded ? "rotate-90" : ""}`} />
                      </button>
                    </td>
                    <td className="num px-2 py-2 text-faint">{e.seq}</td>
                    <td className="num whitespace-nowrap px-2 py-2">
                      <span className="text-faint">{dateOf(e.ts)} </span>
                      {timeOf(e.ts)}
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex flex-col items-start gap-1">
                        <Pill tone={EVENT_TONE[e.event_type] ?? "faint"} size="xs">
                          {e.event_type.replace(/_/g, " ")}
                        </Pill>
                        {e.source === "seed-sample" && (
                          <Pill tone="faint" size="xs">
                            sample data
                          </Pill>
                        )}
                        {e.source === "simulation-control" && (
                          <Pill tone="faint" size="xs">
                            demo control
                          </Pill>
                        )}
                      </div>
                    </td>
                    <td className="num px-2 py-2">{e.incident_id ?? "—"}</td>
                    <td className="px-2 py-2">{e.actor}</td>
                    <td className="px-2 py-2 leading-snug">{e.summary}</td>
                    <td className="num px-2 py-2 text-faint" title={e.hash}>
                      {e.hash.slice(0, 10)}
                    </td>
                  </tr>
                  {expanded && (
                    <tr className="bg-raised/40">
                      <td />
                      <td colSpan={7} className="px-2 pb-3">
                        <div className="num grid gap-1 text-[10.5px] text-faint">
                          <span>prev_hash {e.prev_hash}</span>
                          <span>hash&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{e.hash}</span>
                        </div>
                        <pre className="mt-2 max-h-56 overflow-auto rounded-md border border-line bg-surface p-2 font-mono text-[10.5px] text-muted">
                          {JSON.stringify(e.payload, null, 2)}
                        </pre>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-muted">
                  {loading ? "Loading ledger…" : "No entries for this filter."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
