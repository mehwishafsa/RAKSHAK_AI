import type { DetectionRisk, IncidentStatus, SignalKey } from "../types";

export const SIGNAL_META: Record<SignalKey, { label: string; unit: string; decimals: number; short: string }> = {
  vibration_rms: { label: "Vibration RMS", short: "Vibration", unit: "mm/s", decimals: 2 },
  kurtosis: { label: "Vibration kurtosis", short: "Kurtosis", unit: "", decimals: 2 },
  temperature: { label: "Housing temperature", short: "Temperature", unit: "°C", decimals: 1 },
  pressure: { label: "Lube-oil pressure", short: "Pressure", unit: "bar", decimals: 2 },
  oil_quality: { label: "Oil quality index", short: "Oil quality", unit: "", decimals: 1 },
};

export const fmt = (v: number | undefined | null, decimals = 2) =>
  v === undefined || v === null || Number.isNaN(v) ? "—" : v.toFixed(decimals);

export const RISK_TONE: Record<DetectionRisk, "good" | "warn" | "crit" | "faint"> = {
  LOW: "good",
  MEDIUM: "warn",
  CRITICAL: "crit",
  OFFLINE: "faint",
};

export const STATUS_LABEL: Record<IncidentStatus, string> = {
  AWAITING_APPROVAL: "Awaiting approval",
  IN_PROGRESS: "Work in progress",
  VERIFYING: "Verifying outcome",
  RESOLVED: "Resolved",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
  INTERRUPTED: "Interrupted",
};

export function timeOf(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

export function dateOf(iso: string): string {
  return new Date(iso).toLocaleDateString([], { day: "2-digit", month: "short" });
}
