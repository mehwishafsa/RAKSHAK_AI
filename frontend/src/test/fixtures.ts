import type { Detection, Incident, TelemetryFrame } from "../types";

export const criticalDetection: Detection = {
  anomaly_score: 0.93,
  risk: "CRITICAL",
  fault: {
    code: "BEARING_DEFECT",
    label: "Bearing defect (outer race)",
    component: "bearing_3",
    component_label: "Bearing #3 (gearbox output, drive-end)",
    rule: "vibration severity ≥ 0.15 AND kurtosis ≥ 4.0 (impulsive impacts)",
    evidence: 0.8,
  },
  contributions: [
    { key: "vibration_rms", label: "Vibration RMS", severity: 0.9, share: 0.6, z_score: 300, text: "Vibration RMS 4.9× baseline — dominant factor" },
    { key: "kurtosis", label: "Vibration kurtosis", severity: 0.6, share: 0.4, z_score: 150, text: "Vibration kurtosis 4.0× baseline" },
    { key: "temperature", label: "Housing temperature", severity: 0, share: 0, z_score: 1, text: "within normal band" },
  ],
  signals: {},
  method: "rule-based",
};

export const incident: Incident = {
  id: "INC-0001",
  machine_id: "CD-07",
  created_at: "2026-10-14T10:00:00Z",
  updated_at: "2026-10-14T10:00:00Z",
  status: "AWAITING_APPROVAL",
  risk: "CRITICAL",
  anomaly_score: 0.9,
  fault: criticalDetection.fault!,
  explanation: { method: "rule-based", contributions: criticalDetection.contributions, rule: criticalDetection.fault!.rule },
  action: {
    title: "Replace Bearing #3 and re-grease drive-end assembly",
    component: "bearing_3",
    component_label: "Bearing #3 (gearbox output, drive-end)",
    steps: ["LOTO", "Replace bearing"],
    est_hours: 3.5,
    technicians: 2,
    skills: ["Mechanical fitter"],
    priority: "Immediate",
    window: "Controlled shutdown now",
    inventory: {
      all_available: false,
      lines: [
        { sku: "BRG-6312-2RS", name: "Bearing", unit: "ea", required: 1, on_hand: 4, location: "A", available: true, shortfall: 0, reorder_after_use: false },
        { sku: "GSK-PUMP-45", name: "Gasket", unit: "ea", required: 2, on_hand: 1, location: "A", available: false, shortfall: 1, reorder_after_use: false },
      ],
    },
    source: "rule template",
  },
  decided_by: null,
  decided_at: null,
  decision_note: null,
  work_order: null,
  outcome: null,
};

export function frameWith(partial: Partial<TelemetryFrame> = {}): TelemetryFrame {
  return {
    type: "telemetry",
    seq: 1,
    ts: "2026-10-14T10:00:00Z",
    sim_time: 10,
    speed: 1,
    simulated: true,
    machine: { id: "CD-07", name: "Conveyor Drive CD-07", state: "RUNNING", estop_latched: false, rpm: 1480, injected_scenario: null },
    readings: { vibration_rms: 1.8, vibration_peak: 3, kurtosis: 1.7, crest_factor: 1.9, temperature: 58, pressure: 3, oil_quality: 92 },
    waveform: [],
    detection: { ...criticalDetection, anomaly_score: 0, risk: "LOW", fault: null },
    incident: null,
    ledger_head: { count: 3, last_seq: 3, last_hash: "x" },
    ...partial,
  };
}
