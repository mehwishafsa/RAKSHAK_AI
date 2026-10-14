"""
Anomaly detection, rule-based fault classification and feature-contribution
explanations.

Nothing in here is a trained model. It is deterministic, documented computation:

1. Baseline: mean / standard deviation of every monitored signal, learned from a
   window of healthy operation ("commissioning baseline").
2. Smoothing: an exponentially weighted moving average (EWMA) per signal.
3. Per-signal severity in [0, 1]:
       s = clamp((deviation_in_bad_direction - 3 sigma) / (|trip - baseline| - 3 sigma), 0, 1)
   i.e. 0 inside the normal noise band, 1 at the engineering trip limit.
4. Anomaly score = 1 - prod(1 - s_i)   (any one signal at its trip limit -> 1.0).
5. Risk level from the score, with hard overrides from alarm / trip limits.
6. Fault classification from explicit IF-THEN rules over the severities.
7. Explanation = each signal's share of total severity, ranked, in plain language.
   This is a rule/feature-contribution explanation, NOT SHAP.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Iterable

from .simulator import SensorFrame


@dataclass(frozen=True)
class SignalSpec:
    key: str
    label: str
    unit: str
    direction: int  # +1: higher is worse, -1: lower is worse
    alarm: float
    trip: float
    decimals: int
    # How to phrase the deviation: "ratio" (x baseline), "delta" (absolute), "percent".
    phrasing: str = "percent"


# Limits are engineering heuristics for this simulated machine. Vibration zones are
# modelled on ISO 10816-3 (group 2 machines, flexible foundation: 2.3 / 4.5 / 7.1 mm/s).
SIGNALS: tuple[SignalSpec, ...] = (
    SignalSpec("vibration_rms", "Vibration RMS", "mm/s", +1, alarm=4.5, trip=7.1, decimals=2, phrasing="ratio"),
    SignalSpec("kurtosis", "Vibration kurtosis", "", +1, alarm=4.0, trip=7.0, decimals=2, phrasing="ratio"),
    SignalSpec("temperature", "Housing temperature", "°C", +1, alarm=80.0, trip=95.0, decimals=1, phrasing="delta"),
    SignalSpec("pressure", "Lube-oil pressure", "bar", -1, alarm=2.2, trip=1.5, decimals=2),
    SignalSpec("oil_quality", "Oil quality index", "", -1, alarm=70.0, trip=50.0, decimals=1),
)
SIGNAL_BY_KEY = {s.key: s for s in SIGNALS}

EWMA_ALPHA = 0.45
SIGMA_DEADBAND = 3.0
RISK_MEDIUM = 0.30
RISK_CRITICAL = 0.65
RISK_ORDER = {"LOW": 0, "MEDIUM": 1, "CRITICAL": 2}

COMPONENTS = {
    "bearing_3": "Bearing #3 (gearbox output, drive-end)",
    "motor": "Drive motor (stator / cooling)",
    "lube_system": "Gearbox lubrication system",
    "gearbox": "Gearbox",
}

# Fault rules, evaluated in order; every matching rule is a candidate and the one
# with the strongest evidence wins. Text is shown verbatim in the UI.
RULES = (
    {
        "code": "BEARING_DEFECT",
        "label": "Bearing defect (outer race)",
        "component": "bearing_3",
        "rule": "vibration severity ≥ 0.15 AND kurtosis ≥ 4.0 (impulsive impacts)",
    },
    {
        "code": "LUBRICATION_FAULT",
        "label": "Lubrication fault (oil starvation)",
        "component": "lube_system",
        "rule": "lube-oil pressure severity ≥ 0.15 OR oil-quality severity ≥ 0.25",
    },
    {
        "code": "OVERHEATING",
        "label": "Motor overheating",
        "component": "motor",
        "rule": "temperature severity ≥ 0.15 AND lube-oil pressure normal (severity < 0.15)",
    },
)


@dataclass
class Baseline:
    mean: dict[str, float]
    std: dict[str, float]
    windows: int

    @classmethod
    def from_frames(cls, frames: Iterable[SensorFrame]) -> "Baseline":
        frames = list(frames)
        if len(frames) < 2:
            raise ValueError("need at least two frames to learn a baseline")
        mean: dict[str, float] = {}
        std: dict[str, float] = {}
        for spec in SIGNALS:
            values = [getattr(f, spec.key) for f in frames]
            m = sum(values) / len(values)
            var = sum((v - m) ** 2 for v in values) / (len(values) - 1)
            mean[spec.key] = m
            # Floor the std so a perfectly quiet signal can't produce infinite z-scores.
            std[spec.key] = max(math.sqrt(var), 1e-3 * max(abs(m), 1.0))
        return cls(mean=mean, std=std, windows=len(frames))


def signal_severity(spec: SignalSpec, value: float, base_mean: float, base_std: float) -> float:
    deviation = (value - base_mean) * spec.direction
    span = abs(spec.trip - base_mean) - SIGMA_DEADBAND * base_std
    if span <= 0:
        return 1.0 if deviation > 0 else 0.0
    return min(1.0, max(0.0, (deviation - SIGMA_DEADBAND * base_std) / span))


def limit_state(spec: SignalSpec, value: float) -> str:
    v = value * spec.direction
    if v >= spec.trip * spec.direction:
        return "TRIP"
    if v >= spec.alarm * spec.direction:
        return "ALARM"
    return "NORMAL"


def combine_scores(severities: Iterable[float]) -> float:
    remaining = 1.0
    for s in severities:
        remaining *= 1.0 - s
    return 1.0 - remaining


def risk_level(score: float, limit_states: Iterable[str]) -> str:
    states = set(limit_states)
    if score >= RISK_CRITICAL or "TRIP" in states:
        return "CRITICAL"
    if score >= RISK_MEDIUM or "ALARM" in states:
        return "MEDIUM"
    return "LOW"


def classify(sev: dict[str, float], kurtosis: float) -> dict | None:
    candidates: list[tuple[float, dict]] = []
    if sev["vibration_rms"] >= 0.15 and kurtosis >= 4.0:
        candidates.append(((sev["vibration_rms"] + sev["kurtosis"]) / 2, RULES[0]))
    if sev["pressure"] >= 0.15 or sev["oil_quality"] >= 0.25:
        candidates.append((max(sev["pressure"], sev["oil_quality"]), RULES[1]))
    if sev["temperature"] >= 0.15 and sev["pressure"] < 0.15:
        candidates.append((sev["temperature"], RULES[2]))
    if not candidates:
        return None
    evidence, rule = max(candidates, key=lambda c: c[0])
    return {**rule, "component_label": COMPONENTS[rule["component"]], "evidence": round(evidence, 3)}


def _fmt(value: float, spec: SignalSpec) -> str:
    unit = f" {spec.unit}" if spec.unit else ""
    return f"{value:.{spec.decimals}f}{unit}"


def describe(spec: SignalSpec, value: float, base: float, z: float) -> str:
    """Plain-language description of how far a signal is from its baseline."""
    if spec.phrasing == "ratio" and base > 0 and value / base >= 1.5:
        rel = f"{value / base:.1f}× baseline"
    elif spec.phrasing == "delta":
        diff = value - base
        rel = f"{abs(diff):.{spec.decimals}f} {spec.unit} {'above' if diff >= 0 else 'below'} baseline"
    elif base:
        pct = (value - base) / abs(base) * 100
        rel = f"{'up' if pct >= 0 else 'down'} {abs(pct):.0f}% from baseline"
    else:
        rel = "vs baseline"
    return f"{spec.label} {rel} ({_fmt(value, spec)} vs {_fmt(base, spec)}, {z:+.1f}σ)"


class Detector:
    """Stateful per-machine detector: EWMA smoothing + scoring + rules + explanation."""

    def __init__(self, baseline: Baseline) -> None:
        self.baseline = baseline
        self.ewma: dict[str, float] = dict(baseline.mean)

    def reset(self) -> None:
        self.ewma = dict(self.baseline.mean)

    def update(self, frame: SensorFrame) -> dict:
        b = self.baseline
        signals: dict[str, dict] = {}
        severities: dict[str, float] = {}
        states: list[str] = []
        for spec in SIGNALS:
            raw = getattr(frame, spec.key)
            sm = EWMA_ALPHA * raw + (1 - EWMA_ALPHA) * self.ewma[spec.key]
            self.ewma[spec.key] = sm
            z = (sm - b.mean[spec.key]) / b.std[spec.key]
            s = signal_severity(spec, sm, b.mean[spec.key], b.std[spec.key])
            st = limit_state(spec, sm)
            severities[spec.key] = s
            states.append(st)
            signals[spec.key] = {
                "key": spec.key,
                "label": spec.label,
                "unit": spec.unit,
                "value": round(raw, 4),
                "smoothed": round(sm, 4),
                "baseline": round(b.mean[spec.key], 4),
                "baseline_std": round(b.std[spec.key], 4),
                "z_score": round(z, 2),
                "severity": round(s, 4),
                "limit_state": st,
                "alarm": spec.alarm,
                "trip": spec.trip,
                "direction": spec.direction,
            }

        score = combine_scores(severities.values())
        risk = risk_level(score, states)
        fault = classify(severities, self.ewma["kurtosis"]) if risk != "LOW" else None
        if fault is None and risk != "LOW":
            top = max(severities, key=severities.get)
            component = {"vibration_rms": "gearbox", "kurtosis": "gearbox", "temperature": "motor"}.get(
                top, "lube_system"
            )
            fault = {
                "code": "UNCLASSIFIED",
                "label": "Unclassified anomaly",
                "component": component,
                "component_label": COMPONENTS[component],
                "rule": "anomaly score above threshold but no fault rule matched",
                "evidence": round(severities[top], 3),
            }

        return {
            "anomaly_score": round(score, 4),
            "risk": risk,
            "fault": fault,
            "contributions": self.contributions(signals, severities),
            "signals": signals,
            "method": "rule-based: EWMA + baseline z-score + limit severity (not a trained model)",
        }

    @staticmethod
    def contributions(signals: dict[str, dict], severities: dict[str, float]) -> list[dict]:
        total = sum(severities.values())
        ranked = sorted(SIGNALS, key=lambda sp: severities[sp.key], reverse=True)
        out = []
        for rank, spec in enumerate(ranked):
            s = severities[spec.key]
            share = s / total if total > 0 else 0.0
            sig = signals[spec.key]
            text = describe(spec, sig["smoothed"], sig["baseline"], sig["z_score"])
            if total > 0 and rank == 0 and share >= 0.5:
                text += " — dominant factor"
            elif s == 0:
                text += " — within normal band"
            out.append(
                {
                    "key": spec.key,
                    "label": spec.label,
                    "severity": round(s, 4),
                    "share": round(share, 4),
                    "z_score": sig["z_score"],
                    "text": text,
                }
            )
        return out
