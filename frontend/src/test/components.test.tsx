import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActionPanel } from "../components/ActionPanel";
import { ExplainabilityPanel } from "../components/ExplainabilityPanel";
import { RiskPill } from "../components/Pill";
import { stepsComplete } from "../components/PipelineStepper";
import { StatusPanel } from "../components/StatusPanel";
import { TrustLedger } from "../components/TrustLedger";
import { componentTones, shakeAmplitude } from "../twin/health";
import type { LedgerEntry } from "../types";
import { criticalDetection, frameWith, incident } from "./fixtures";

afterEach(() => vi.restoreAllMocks());

function mockFetch(body: unknown, ok = true, status = 200) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok,
    status,
    statusText: "x",
    json: async () => body,
  } as Response);
}

describe("RiskPill", () => {
  it("pairs severity colour with a text label", () => {
    render(<RiskPill risk="CRITICAL" />);
    expect(screen.getByText("Critical")).toBeInTheDocument();
  });
  it("shows paused state when detection is offline", () => {
    render(<RiskPill risk="OFFLINE" />);
    expect(screen.getByText("Detection paused")).toBeInTheDocument();
  });
});

describe("StatusPanel", () => {
  it("shows the computed anomaly score and diagnosis", () => {
    render(<StatusPanel frame={frameWith({ detection: criticalDetection })} />);
    expect(screen.getByTestId("anomaly-score")).toHaveTextContent("93");
    expect(screen.getAllByText("Bearing defect (outer race)").length).toBeGreaterThan(0);
    expect(screen.getByText(/kurtosis ≥ 4.0/)).toBeInTheDocument();
  });
});

describe("ExplainabilityPanel", () => {
  it("ranks contributions and labels the method honestly", () => {
    render(<ExplainabilityPanel detection={criticalDetection} incident={null} />);
    expect(screen.getByText(/not SHAP/i)).toBeInTheDocument();
    const rows = screen.getAllByTestId("contribution");
    expect(rows[0]).toHaveTextContent("Vibration RMS");
    expect(rows[0]).toHaveTextContent("60%");
    expect(rows[0]).toHaveTextContent("dominant factor");
  });
  it("states that all signals are normal when healthy", () => {
    render(<ExplainabilityPanel detection={frameWith().detection} incident={null} />);
    expect(screen.getByText(/within 3σ/)).toBeInTheDocument();
  });
});

describe("ActionPanel approval gate", () => {
  it("explains that nothing executes without approval when idle", () => {
    render(<ActionPanel incident={null} />);
    expect(screen.getByText(/Nothing is\s+executed/)).toBeInTheDocument();
  });

  it("shows the action, inventory shortfall and locked state", () => {
    render(<ActionPanel incident={incident} />);
    expect(screen.getByText(incident.action.title)).toBeInTheDocument();
    expect(screen.getByText("Shortfall")).toBeInTheDocument();
    expect(screen.getByText(/Locked until a human approves/)).toBeInTheDocument();
  });

  it("posts the approval with the approver's name", async () => {
    const fetchMock = mockFetch({ ...incident, status: "IN_PROGRESS" });
    const onDecision = vi.fn();
    render(<ActionPanel incident={incident} onDecision={onDecision} />);
    const name = screen.getByLabelText(/Approver/);
    await userEvent.clear(name);
    await userEvent.type(name, "R. Sharma");
    await userEvent.click(screen.getByRole("button", { name: /Approve action/ }));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/incidents/INC-0001/approve",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ approver: "R. Sharma", note: "" }) }),
    );
    expect(onDecision).toHaveBeenCalled();
  });

  it("requires a reason before rejecting", async () => {
    const fetchMock = mockFetch({ ...incident, status: "REJECTED" });
    render(<ActionPanel incident={incident} />);
    await userEvent.click(screen.getByRole("button", { name: /Reject/ }));
    const confirm = screen.getByRole("button", { name: /Confirm rejection/ });
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Reason/), "Sensor cable loose");
    await userEvent.click(confirm);
    expect(fetchMock).toHaveBeenCalledWith("/api/incidents/INC-0001/reject", expect.objectContaining({ method: "POST" }));
  });

  it("surfaces server errors", async () => {
    mockFetch({ detail: "INC-0001 is IN_PROGRESS, expected AWAITING_APPROVAL" }, false, 409);
    render(<ActionPanel incident={incident} />);
    await userEvent.click(screen.getByRole("button", { name: /Approve action/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("expected AWAITING_APPROVAL");
  });

  it("shows the verified outcome once resolved", () => {
    render(
      <ActionPanel
        incident={{
          ...incident,
          status: "RESOLVED",
          decided_by: "R. Sharma",
          decided_at: "2026-10-14T10:01:00Z",
          work_order: "WO-2026-0001",
          outcome: { verified: true, windows: 10, post_repair_anomaly_score: 0.01 },
        }}
      />,
    );
    expect(screen.getByText(/Outcome verified/)).toBeInTheDocument();
    expect(screen.getByText("WO-2026-0001")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Approve action/ })).not.toBeInTheDocument();
  });
});

describe("pipeline progress", () => {
  it("maps incident status to completed steps", () => {
    expect(stepsComplete(null).done).toBe(0);
    expect(stepsComplete(incident).done).toBe(3);
    expect(stepsComplete({ ...incident, status: "RESOLVED" }).done).toBe(6);
    expect(stepsComplete({ ...incident, status: "REJECTED" }).failed).toBe(true);
  });
});

describe("TrustLedger", () => {
  const entries: LedgerEntry[] = [
    { seq: 2, ts: "2026-10-14T10:00:01Z", machine_id: "CD-07", incident_id: "INC-0001", event_type: "HUMAN_APPROVED", actor: "R. Sharma", source: "live", summary: "Approved", payload: { note: "go" }, prev_hash: "a".repeat(64), hash: "b".repeat(64) },
    { seq: 1, ts: "2026-10-08T10:00:00Z", machine_id: "CD-07", incident_id: null, event_type: "SYSTEM_COMMISSIONED", actor: "seed-script", source: "seed-sample", summary: "Sample", payload: {}, prev_hash: "0".repeat(64), hash: "a".repeat(64) },
  ];

  it("labels sample data and filters to incident events", async () => {
    render(<TrustLedger entries={entries} loading={false} />);
    expect(screen.getByText("sample data")).toBeInTheDocument();
    expect(screen.getAllByTestId("ledger-row")).toHaveLength(2);
    await userEvent.click(screen.getByRole("button", { name: "Incident events" }));
    expect(screen.getAllByTestId("ledger-row")).toHaveLength(1);
  });

  it("verifies the hash chain on demand", async () => {
    mockFetch({ valid: true, checked: 2, broken_at_seq: null, reason: null, head_hash: "b".repeat(64) });
    render(<TrustLedger entries={entries} loading={false} />);
    await userEvent.click(screen.getByRole("button", { name: /Verify hash chain/ }));
    expect(await screen.findByRole("status")).toHaveTextContent("Chain intact");
  });

  it("expands a row to show hashes and payload", async () => {
    render(<TrustLedger entries={entries} loading={false} />);
    await userEvent.click(screen.getAllByTestId("ledger-row")[0]);
    const table = screen.getByRole("table");
    expect(within(table).getByText(/"note": "go"/)).toBeInTheDocument();
  });
});

describe("digital twin state mapping", () => {
  it("highlights only the faulted component, by severity", () => {
    const tones = componentTones(frameWith({ detection: criticalDetection }));
    expect(tones.bearing_3).toBe("crit");
    expect(tones.motor).toBe("none");
  });
  it("does not highlight an unclassified anomaly", () => {
    const d = { ...criticalDetection, fault: { ...criticalDetection.fault!, code: "UNCLASSIFIED" as const } };
    expect(Object.values(componentTones(frameWith({ detection: d }))).every((t) => t === "none")).toBe(true);
  });
  it("shows maintenance tone during approved work", () => {
    const tones = componentTones(frameWith({ incident: { ...incident, status: "IN_PROGRESS" } }));
    expect(tones.bearing_3).toBe("maint");
  });
  it("shakes harder when critical and never under reduced motion", () => {
    const crit = frameWith({ detection: criticalDetection, readings: { ...frameWith().readings, vibration_rms: 8 } });
    expect(shakeAmplitude(crit, false)).toBeGreaterThan(shakeAmplitude(frameWith(), false));
    expect(shakeAmplitude(frameWith(), false)).toBe(0);
    expect(shakeAmplitude(crit, true)).toBe(0);
  });
});
