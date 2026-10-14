// Typed API contracts — mirror backend/rakshak/schemas.py and engine.py messages.

export type Risk = "LOW" | "MEDIUM" | "CRITICAL";
export type DetectionRisk = Risk | "OFFLINE";
export type MachineState = "RUNNING" | "E_STOP" | "MAINTENANCE";
export type ScenarioId = "bearing" | "overheating" | "lubrication";
export type SignalKey = "vibration_rms" | "kurtosis" | "temperature" | "pressure" | "oil_quality";
export type ComponentId = "bearing_3" | "motor" | "lube_system" | "gearbox";

export type IncidentStatus =
  | "AWAITING_APPROVAL"
  | "IN_PROGRESS"
  | "VERIFYING"
  | "RESOLVED"
  | "REJECTED"
  | "CANCELLED"
  | "INTERRUPTED";

export interface SignalState {
  key: SignalKey;
  label: string;
  unit: string;
  value: number;
  smoothed: number;
  baseline: number;
  baseline_std: number;
  z_score: number;
  severity: number;
  limit_state: "NORMAL" | "ALARM" | "TRIP";
  alarm: number;
  trip: number;
  direction: 1 | -1;
}

export interface Contribution {
  key: SignalKey;
  label: string;
  severity: number;
  share: number;
  z_score: number;
  text: string;
}

export interface Fault {
  code: "BEARING_DEFECT" | "OVERHEATING" | "LUBRICATION_FAULT" | "UNCLASSIFIED";
  label: string;
  component: ComponentId;
  component_label: string;
  rule: string;
  evidence: number;
}

export interface Detection {
  anomaly_score: number;
  risk: DetectionRisk;
  fault: Fault | null;
  contributions: Contribution[];
  signals: Partial<Record<SignalKey, SignalState>>;
  method: string;
}

export interface InventoryLine {
  sku: string;
  name: string;
  unit: string;
  required: number;
  on_hand: number;
  location: string;
  available: boolean;
  shortfall: number;
  reorder_after_use: boolean;
}

export interface Action {
  title: string;
  component: ComponentId;
  component_label: string;
  steps: string[];
  est_hours: number;
  technicians: number;
  skills: string[];
  priority: string;
  window: string;
  inventory: { all_available: boolean; lines: InventoryLine[] };
  source: string;
}

export interface Incident {
  id: string;
  machine_id: string;
  created_at: string;
  updated_at: string;
  status: IncidentStatus;
  risk: Risk;
  anomaly_score: number;
  fault: Fault;
  explanation: { method: string; contributions: Contribution[]; rule: string };
  action: Action;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  work_order: string | null;
  outcome: { verified: boolean; windows: number; post_repair_anomaly_score: number } | null;
}

export interface Readings {
  vibration_rms: number;
  vibration_peak: number;
  kurtosis: number;
  crest_factor: number;
  temperature: number;
  pressure: number;
  oil_quality: number;
}

export interface TelemetryFrame {
  type: "telemetry";
  seq: number;
  ts: string;
  sim_time: number;
  speed: number;
  simulated: true;
  machine: {
    id: string;
    name: string;
    state: MachineState;
    estop_latched: boolean;
    rpm: number;
    injected_scenario: ScenarioId | null;
  };
  readings: Readings;
  waveform: number[];
  detection: Detection;
  incident: Incident | null;
  ledger_head: { count: number; last_seq: number; last_hash: string };
}

export interface LedgerEntry {
  seq: number;
  ts: string;
  machine_id: string;
  incident_id: string | null;
  event_type: string;
  actor: string;
  source: "live" | "simulation-control" | "seed-sample";
  summary: string;
  payload: Record<string, unknown>;
  prev_hash: string;
  hash: string;
}

export interface LedgerVerification {
  valid: boolean;
  checked: number;
  broken_at_seq: number | null;
  reason: string | null;
  head_hash?: string | null;
}

export interface AppState {
  machine: { id: string; name: string; site: string; model: string; commissioned: string; state: MachineState };
  speed: number;
  speeds: number[];
  scenarios: { id: ScenarioId; label: string }[];
  baseline: { windows: number; mean: Record<SignalKey, number>; std: Record<SignalKey, number> };
  tick_seconds: number;
}
