"""
Physics-flavoured sensor simulator for one conveyor drive (motor -> gearbox -> pulley).

Everything produced here is SIMULATED data. It is designed to be plausible, not to
be a validated physical model:

  * Vibration: each tick synthesises a raw velocity waveform (mm/s) sampled at
    2048 Hz for 0.25 s. Healthy = shaft 1x/2x harmonics + Gaussian noise. A bearing
    defect adds a train of decaying resonance "rings" at the outer-race defect
    frequency (BPFO ~= 3.58 x shaft speed), which is what makes RMS and kurtosis
    rise. RMS / kurtosis / crest factor are then *computed* from that waveform.
  * Temperature, lube-oil pressure and oil quality follow first-order lags toward
    targets that depend on speed and the injected fault.

A fault "scenario" is injected by the demo controls; its severity ramps from 0 to 1
with a time constant of FAULT_TAU seconds of simulated time.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass, field

SAMPLE_RATE_HZ = 2048
WINDOW_SAMPLES = 512  # 0.25 s window per tick
WAVEFORM_PREVIEW_SAMPLES = 160  # ~78 ms, about two shaft revolutions, sent to the UI

NOMINAL_RPM = 1480.0  # 4-pole induction motor, 50 Hz supply
BPFO_ORDER = 3.58  # outer-race defect frequency as a multiple of shaft speed
RESONANCE_HZ = 610.0  # structural resonance excited by bearing impacts
FAULT_TAU = 1.6  # seconds (sim time) for fault severity to reach ~63 %

AMBIENT_C = 34.0
HEALTHY_TEMP_C = 58.0
HEALTHY_PRESSURE_BAR = 3.0
HEALTHY_OIL_QUALITY = 92.0

SCENARIOS = ("bearing", "overheating", "lubrication")


@dataclass
class SensorFrame:
    sim_time: float
    rpm: float
    vibration_rms: float  # mm/s RMS velocity
    vibration_peak: float  # mm/s
    kurtosis: float  # dimensionless, 3.0 == Gaussian
    crest_factor: float
    temperature: float  # deg C, bearing / motor housing
    pressure: float  # bar, lube-oil header
    oil_quality: float  # 0-100 index
    waveform: list[float] = field(default_factory=list)


def waveform_stats(samples: list[float]) -> tuple[float, float, float, float]:
    """Return (rms, peak, kurtosis, crest_factor) for a waveform.

    Kurtosis is the (non-excess) fourth standardised moment: 1.5 for a pure sine,
    3.0 for Gaussian noise, and well above 3 for impulsive (impact) signals.
    """
    n = len(samples)
    if n == 0:
        return 0.0, 0.0, 0.0, 0.0
    mean = sum(samples) / n
    centred = [x - mean for x in samples]
    m2 = sum(c * c for c in centred) / n
    m4 = sum(c**4 for c in centred) / n
    rms = math.sqrt(sum(x * x for x in samples) / n)
    peak = max(abs(x) for x in samples)
    kurt = m4 / (m2 * m2) if m2 > 1e-12 else 0.0
    crest = peak / rms if rms > 1e-12 else 0.0
    return rms, peak, kurt, crest


class MachineSimulator:
    def __init__(self, seed: int = 7) -> None:
        self.rng = random.Random(seed)
        self.sim_time = 0.0
        self.rpm = NOMINAL_RPM
        self.target_rpm = NOMINAL_RPM
        self.scenario: str | None = None
        self.severity = 0.0
        self.temperature = HEALTHY_TEMP_C
        self.pressure = HEALTHY_PRESSURE_BAR
        self.oil_quality = HEALTHY_OIL_QUALITY
        self._phase = 0.0

    # ----- controls ---------------------------------------------------------
    def inject(self, scenario: str) -> None:
        if scenario not in SCENARIOS:
            raise ValueError(f"unknown scenario {scenario!r}")
        if scenario != self.scenario:
            self.scenario = scenario
            self.severity = 0.0
        self.target_rpm = NOMINAL_RPM

    def clear_fault(self) -> None:
        """Fault physically repaired: severity gone, oil refreshed."""
        self.scenario = None
        self.severity = 0.0
        self.oil_quality = max(self.oil_quality, HEALTHY_OIL_QUALITY)

    def reset(self) -> None:
        self.clear_fault()
        self.target_rpm = NOMINAL_RPM
        self.rpm = NOMINAL_RPM
        self.temperature = HEALTHY_TEMP_C
        self.pressure = HEALTHY_PRESSURE_BAR
        self.oil_quality = HEALTHY_OIL_QUALITY

    def stop(self) -> None:
        self.target_rpm = 0.0

    def start(self) -> None:
        self.target_rpm = NOMINAL_RPM

    @property
    def running(self) -> bool:
        return self.rpm > 0.5 * NOMINAL_RPM

    # ----- dynamics ---------------------------------------------------------
    @staticmethod
    def _lag(current: float, target: float, dt: float, tau: float) -> float:
        return target + (current - target) * math.exp(-dt / tau)

    def step(self, dt: float) -> SensorFrame:
        rng = self.rng
        self.sim_time += dt

        if self.scenario is not None:
            self.severity = 1.0 - (1.0 - self.severity) * math.exp(-dt / FAULT_TAU)
        sev = self.severity
        bearing = sev if self.scenario == "bearing" else 0.0
        heat = sev if self.scenario == "overheating" else 0.0
        lube = sev if self.scenario == "lubrication" else 0.0

        self.rpm = self._lag(self.rpm, self.target_rpm, dt, 1.2)
        if self.rpm < 5 and self.target_rpm == 0.0:
            self.rpm = 0.0
        speed_ratio = self.rpm / NOMINAL_RPM

        # Thermal: running load heat + fault heat (lube starvation adds friction heat).
        temp_target = AMBIENT_C + (HEALTHY_TEMP_C - AMBIENT_C) * speed_ratio
        temp_target += speed_ratio * (50.0 * heat + 14.0 * lube + 6.0 * bearing)
        self.temperature = self._lag(self.temperature, temp_target, dt, 1.0)

        pressure_target = HEALTHY_PRESSURE_BAR * speed_ratio * (1.0 - 0.62 * lube)
        self.pressure = self._lag(self.pressure, pressure_target, dt, 1.0)

        oil_target = HEALTHY_OIL_QUALITY - 48.0 * lube - 18.0 * heat
        if oil_target < self.oil_quality:
            self.oil_quality = self._lag(self.oil_quality, oil_target, dt, 3.0)

        samples = self._vibration_window(speed_ratio, bearing, heat, lube)
        rms, peak, kurt, crest = waveform_stats(samples)

        return SensorFrame(
            sim_time=round(self.sim_time, 3),
            rpm=round(self.rpm, 1),
            vibration_rms=rms,
            vibration_peak=peak,
            kurtosis=kurt,
            crest_factor=crest,
            temperature=self.temperature + rng.gauss(0, 0.25),
            pressure=max(0.0, self.pressure + rng.gauss(0, 0.025)),
            oil_quality=min(100.0, max(0.0, self.oil_quality + rng.gauss(0, 0.3))),
            waveform=[round(x, 3) for x in samples[:WAVEFORM_PREVIEW_SAMPLES]],
        )

    def _vibration_window(self, speed_ratio: float, bearing: float, heat: float, lube: float) -> list[float]:
        rng = self.rng
        shaft_hz = self.rpm / 60.0
        # Velocity amplitude scales roughly with speed; faults add looseness / rub energy.
        amp_1x = 2.4 * speed_ratio * (1.0 + 0.25 * heat + 0.35 * lube + 0.9 * bearing)
        amp_2x = 0.45 * speed_ratio
        noise_sd = (0.32 + 0.6 * lube + 1.6 * bearing) * max(speed_ratio, 0.05)

        impact_amp = 40.0 * bearing * speed_ratio
        defect_hz = BPFO_ORDER * shaft_hz
        impact_period = int(SAMPLE_RATE_HZ / defect_hz) if defect_hz > 1 else 0
        ring_decay = 0.002  # seconds
        ring_len = int(0.006 * SAMPLE_RATE_HZ)

        out = [0.0] * WINDOW_SAMPLES
        w1 = 2 * math.pi * shaft_hz / SAMPLE_RATE_HZ
        wr = 2 * math.pi * RESONANCE_HZ / SAMPLE_RATE_HZ
        for i in range(WINDOW_SAMPLES):
            ph = self._phase + w1 * i
            out[i] = amp_1x * math.sin(ph) + amp_2x * math.sin(2 * ph + 0.6) + rng.gauss(0, noise_sd)

        if impact_amp > 0.05 and impact_period > 0:
            start = rng.randrange(impact_period)
            for k in range(start, WINDOW_SAMPLES, impact_period):
                a = impact_amp * rng.uniform(0.7, 1.3)
                for j in range(min(ring_len, WINDOW_SAMPLES - k)):
                    t = j / SAMPLE_RATE_HZ
                    out[k + j] += a * math.exp(-t / ring_decay) * math.sin(wr * j)

        self._phase = (self._phase + w1 * WINDOW_SAMPLES) % (2 * math.pi)
        return out
