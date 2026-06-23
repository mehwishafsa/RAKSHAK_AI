"""
models/train_baseline.py

Trains the baseline anomaly detection model used by the Rakshak AI prototype.

Data: synthetic vibration signals (sine wave + noise + injected fault impulses).
This is an explicit stand-in for real sensor data (see datasets/README.md) — used
to validate the feature-extraction -> model pipeline before real datasets
(CWRU bearing dataset) are integrated in Phase 2.

Run:
    python models/train_baseline.py

Output:
    models/baseline_isolation_forest.joblib
"""

import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
import joblib
import os

RNG = np.random.default_rng(seed=42)
SAMPLE_RATE_HZ = 2000
WINDOW_SECONDS = 1.0
N_SAMPLES_PER_WINDOW = int(SAMPLE_RATE_HZ * WINDOW_SECONDS)


def generate_window(is_faulty: bool) -> np.ndarray:
    """Generate one window of synthetic vibration signal.

    Healthy signal: clean sine wave (simulating shaft rotation) + low noise.
    Faulty signal: same base sine wave + periodic high-frequency impulses
    (simulating a bearing defect impact) + higher noise floor.
    """
    t = np.arange(N_SAMPLES_PER_WINDOW) / SAMPLE_RATE_HZ
    base_freq_hz = 50.0  # simulated shaft rotation frequency
    signal = np.sin(2 * np.pi * base_freq_hz * t)

    noise_level = 0.05 if not is_faulty else 0.15
    signal += RNG.normal(0, noise_level, size=signal.shape)

    if is_faulty:
        # Inject periodic impulses at a higher frequency band to simulate
        # a localized bearing defect impact.
        impulse_freq_hz = 300.0
        impulse_positions = np.arange(0, N_SAMPLES_PER_WINDOW, int(SAMPLE_RATE_HZ / impulse_freq_hz))
        impulse = np.zeros(N_SAMPLES_PER_WINDOW)
        impulse[impulse_positions] = RNG.uniform(0.8, 1.5, size=len(impulse_positions))
        signal += impulse

    return signal


def extract_features(signal: np.ndarray) -> dict:
    """Statistical + frequency-domain features for one window."""
    fft_vals = np.abs(np.fft.rfft(signal))
    freqs = np.fft.rfftfreq(len(signal), d=1.0 / SAMPLE_RATE_HZ)

    high_band_mask = freqs > 200  # energy above 200Hz -> impact/defect band
    high_band_energy = fft_vals[high_band_mask].sum()

    mean = signal.mean()
    std = signal.std()
    rms = np.sqrt(np.mean(signal ** 2))
    kurtosis = (((signal - mean) ** 4).mean()) / (std ** 4 + 1e-9)
    crest_factor = np.max(np.abs(signal)) / (rms + 1e-9)

    return {
        "rms": rms,
        "kurtosis": kurtosis,
        "crest_factor": crest_factor,
        "high_band_energy": high_band_energy,
    }


def build_dataset(n_healthy: int = 300, n_faulty: int = 60) -> pd.DataFrame:
    rows = []
    for _ in range(n_healthy):
        rows.append({**extract_features(generate_window(is_faulty=False)), "label": "healthy"})
    for _ in range(n_faulty):
        rows.append({**extract_features(generate_window(is_faulty=True)), "label": "faulty"})
    return pd.DataFrame(rows)


def main():
    df = build_dataset()
    feature_cols = ["rms", "kurtosis", "crest_factor", "high_band_energy"]

    # IsolationForest is unsupervised: trained without label, contamination
    # set roughly to the proportion of injected "faulty" windows so the
    # model has a realistic anomaly rate to calibrate against.
    contamination = (df["label"] == "faulty").mean()
    model = IsolationForest(
        n_estimators=200,
        contamination=contamination,
        random_state=42,
    )
    model.fit(df[feature_cols])

    df["predicted_anomaly"] = model.predict(df[feature_cols])  # -1 = anomaly, 1 = normal
    df["anomaly_score"] = -model.score_samples(df[feature_cols])  # higher = more anomalous

    # Quick sanity check printed to console: does the unsupervised model's
    # anomaly flag roughly line up with our injected fault labels?
    detected_faulty = df[(df["label"] == "faulty") & (df["predicted_anomaly"] == -1)].shape[0]
    total_faulty = (df["label"] == "faulty").sum()
    print(f"Detected {detected_faulty}/{total_faulty} injected-faulty windows as anomalous.")

    out_dir = os.path.dirname(__file__)
    model_path = os.path.join(out_dir, "baseline_isolation_forest.joblib")
    joblib.dump({"model": model, "feature_cols": feature_cols}, model_path)
    print(f"Saved model to {model_path}")


if __name__ == "__main__":
    main()
