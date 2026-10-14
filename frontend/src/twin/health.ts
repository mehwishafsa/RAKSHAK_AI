import type { ComponentId, TelemetryFrame } from "../types";

export type Tone = "none" | "warn" | "crit" | "maint";

export const COMPONENT_IDS: ComponentId[] = ["motor", "gearbox", "bearing_3", "lube_system"];

export const COMPONENT_TAGS: Record<ComponentId, string> = {
  motor: "M1 · Drive motor",
  gearbox: "GBX · Gearbox",
  bearing_3: "BRG #3",
  lube_system: "LUBE · Oil system",
};

/**
 * Which component to highlight, and how. Driven only by the backend's detection
 * result and incident state — the twin never "knows" which fault was injected.
 */
export function componentTones(frame: TelemetryFrame | null): Record<ComponentId, Tone> {
  const tones: Record<ComponentId, Tone> = { motor: "none", gearbox: "none", bearing_3: "none", lube_system: "none" };
  if (!frame) return tones;
  const { detection, incident } = frame;

  if (incident && incident.status === "IN_PROGRESS") {
    tones[incident.fault.component] = "maint";
    return tones;
  }
  // Only highlight once a rule has localised the fault (an UNCLASSIFIED anomaly has no reliable component).
  const located = detection.fault && detection.fault.code !== "UNCLASSIFIED";
  if (located && (detection.risk === "MEDIUM" || detection.risk === "CRITICAL")) {
    tones[detection.fault!.component] = detection.risk === "CRITICAL" ? "crit" : "warn";
  } else if (incident && incident.status === "AWAITING_APPROVAL" && detection.risk !== "OFFLINE") {
    tones[incident.fault.component] = incident.risk === "CRITICAL" ? "crit" : "warn";
  }
  return tones;
}

/** Shake amplitude (scene units). Driven by measured vibration plus risk level. */
export function shakeAmplitude(frame: TelemetryFrame | null, reducedMotion: boolean): number {
  if (!frame || reducedMotion) return 0;
  const vib = frame.readings.vibration_rms;
  const fromVibration = Math.min(1, Math.max(0, (vib - 2.3) / 6)) * 0.022;
  const fromRisk = frame.detection.risk === "CRITICAL" ? 0.012 : frame.detection.risk === "MEDIUM" ? 0.005 : 0;
  return Math.max(fromVibration, fromRisk);
}

/** Visual rotation speed (rad/s). Real 1480 rpm is slowed ~30x so rotation reads on screen. */
export function visualMotorSpeed(rpm: number): number {
  return (rpm / 1480) * Math.PI * 1.6;
}

export const GEAR_RATIO = 4;
