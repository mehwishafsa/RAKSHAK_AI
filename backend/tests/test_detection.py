import math

import pytest

from backend.rakshak.detection import (
    SIGNAL_BY_KEY,
    Baseline,
    Detector,
    classify,
    combine_scores,
    describe,
    limit_state,
    risk_level,
    signal_severity,
)
from backend.rakshak.engine import Engine
from backend.rakshak.simulator import MachineSimulator, waveform_stats


@pytest.fixture(scope="module")
def baseline():
    return Engine._calibrate(1007)


def run_scenario(baseline, scenario, ticks=40, seed=3):
    sim, det = MachineSimulator(seed), Detector(baseline)
    for _ in range(20):
        det.update(sim.step(0.2))
    if scenario:
        sim.inject(scenario)
    return [det.update(sim.step(0.2)) for _ in range(ticks)]


# ---- signal statistics -------------------------------------------------------
def test_waveform_stats_pure_sine():
    n = 2048
    sine = [math.sin(2 * math.pi * 8 * i / n) for i in range(n)]
    rms, peak, kurt, crest = waveform_stats(sine)
    assert rms == pytest.approx(1 / math.sqrt(2), rel=1e-3)
    assert peak == pytest.approx(1.0, rel=1e-3)
    assert kurt == pytest.approx(1.5, rel=1e-2)  # kurtosis of a sinusoid
    assert crest == pytest.approx(math.sqrt(2), rel=1e-3)


def test_waveform_stats_impulsive_signal_has_high_kurtosis():
    sig = [0.0] * 1000
    for i in range(0, 1000, 100):
        sig[i] = 10.0
    sig = [x + (0.01 if i % 2 else -0.01) for i, x in enumerate(sig)]
    assert waveform_stats(sig)[2] > 8


def test_waveform_stats_empty():
    assert waveform_stats([]) == (0.0, 0.0, 0.0, 0.0)


def test_baseline_requires_frames():
    with pytest.raises(ValueError):
        Baseline.from_frames([])


# ---- scoring primitives ----------------------------------------------------
def test_severity_zero_inside_noise_band_and_one_at_trip():
    spec = SIGNAL_BY_KEY["vibration_rms"]
    assert signal_severity(spec, 1.8, 1.75, 0.02) == 0.0
    assert signal_severity(spec, 7.1, 1.75, 0.02) == pytest.approx(1.0)
    assert 0 < signal_severity(spec, 4.0, 1.75, 0.02) < 1


def test_severity_respects_direction_for_pressure():
    spec = SIGNAL_BY_KEY["pressure"]
    assert signal_severity(spec, 3.5, 3.0, 0.03) == 0.0  # higher pressure is not a fault
    assert signal_severity(spec, 1.5, 3.0, 0.03) == pytest.approx(1.0)


def test_limit_state_both_directions():
    assert limit_state(SIGNAL_BY_KEY["temperature"], 70) == "NORMAL"
    assert limit_state(SIGNAL_BY_KEY["temperature"], 85) == "ALARM"
    assert limit_state(SIGNAL_BY_KEY["temperature"], 96) == "TRIP"
    assert limit_state(SIGNAL_BY_KEY["pressure"], 2.0) == "ALARM"
    assert limit_state(SIGNAL_BY_KEY["pressure"], 1.4) == "TRIP"


def test_combine_scores():
    assert combine_scores([0, 0, 0]) == 0
    assert combine_scores([0.5, 0.5]) == pytest.approx(0.75)
    assert combine_scores([1.0, 0.1]) == pytest.approx(1.0)


def test_risk_level_thresholds_and_overrides():
    assert risk_level(0.1, ["NORMAL"]) == "LOW"
    assert risk_level(0.4, ["NORMAL"]) == "MEDIUM"
    assert risk_level(0.7, ["NORMAL"]) == "CRITICAL"
    assert risk_level(0.05, ["ALARM"]) == "MEDIUM"
    assert risk_level(0.05, ["TRIP"]) == "CRITICAL"


# ---- rules ------------------------------------------------------------------
def sev(**kw):
    base = dict(vibration_rms=0, kurtosis=0, temperature=0, pressure=0, oil_quality=0)
    base.update(kw)
    return base


def test_rules():
    assert classify(sev(vibration_rms=0.5, kurtosis=0.4), kurtosis=5.0)["code"] == "BEARING_DEFECT"
    # High vibration without impulsiveness is not a bearing defect.
    assert classify(sev(vibration_rms=0.5), kurtosis=2.0) is None
    assert classify(sev(temperature=0.5), kurtosis=1.7)["code"] == "OVERHEATING"
    assert classify(sev(pressure=0.6, temperature=0.3), kurtosis=1.7)["code"] == "LUBRICATION_FAULT"
    assert classify(sev(oil_quality=0.3), kurtosis=1.7)["code"] == "LUBRICATION_FAULT"
    assert classify(sev(), kurtosis=1.7) is None


def test_describe_phrasing():
    assert "3.0× baseline" in describe(SIGNAL_BY_KEY["vibration_rms"], 6.0, 2.0, 50)
    assert "20.0 °C above baseline" in describe(SIGNAL_BY_KEY["temperature"], 78.0, 58.0, 30)
    assert "down 50% from baseline" in describe(SIGNAL_BY_KEY["pressure"], 1.5, 3.0, -40)


# ---- end-to-end on simulated signal ------------------------------------------
def test_healthy_stream_has_no_false_alarms(baseline):
    results = run_scenario(baseline, None, ticks=300)
    assert all(r["risk"] == "LOW" for r in results)
    assert max(r["anomaly_score"] for r in results) < 0.1


@pytest.mark.parametrize(
    "scenario,code,top_signal",
    [
        ("bearing", "BEARING_DEFECT", {"vibration_rms", "kurtosis"}),
        ("overheating", "OVERHEATING", {"temperature"}),
        ("lubrication", "LUBRICATION_FAULT", {"pressure", "oil_quality"}),
    ],
)
def test_scenarios_are_detected_classified_and_explained(baseline, scenario, code, top_signal):
    results = run_scenario(baseline, scenario)
    final = results[-1]
    assert final["risk"] == "CRITICAL"
    assert final["fault"]["code"] == code
    assert final["contributions"][0]["key"] in top_signal
    shares = [c["share"] for c in final["contributions"]]
    assert sum(shares) == pytest.approx(1.0, abs=1e-3)
    assert shares == sorted(shares, reverse=True)
    # Responsive: elevated risk within ~2 s of simulated time (10 windows of 0.2 s).
    first_elevated = next(i for i, r in enumerate(results) if r["risk"] != "LOW")
    assert first_elevated <= 10


def test_contributions_are_zero_when_healthy(baseline):
    final = run_scenario(baseline, None, ticks=20)[-1]
    assert all(c["share"] == 0 for c in final["contributions"])
