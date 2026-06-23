# Architecture

## Purpose of this document
Describes how Rakshak AI's components fit together today, and how they are intended to fit together once the Trust Index and Action Recommendation Engine are built. Clearly separates **implemented** from **designed**.

## 1. System Layers

### Layer 1 — Data Ingestion
- Accepts time-series sensor data (vibration, temperature, acoustic) in a normalized schema:
  `{ machine_id, sensor_type, timestamp, value, unit }`
- Goal: be OEM-agnostic. Any sensor feed that can be mapped to this schema can be ingested.
- **Status:** Schema defined. No live ingestion pipeline yet — current data path is synthetic generation → model, for prototyping.

### Layer 2 — Feature Extraction
- Rolling statistical features (mean, RMS, kurtosis, crest factor) and frequency-domain features (FFT band energy) computed over sliding windows.
- **Status:** Implemented in `notebooks/01_synthetic_vibration_eda.ipynb` and reused in `models/train_baseline.py`.

### Layer 3 — Prediction Model
- Baseline: unsupervised anomaly detection (`IsolationForest`) trained on extracted features.
- Rationale for starting here: real failure-labeled data is scarce and expensive to obtain; unsupervised anomaly scoring is the realistic starting point for any early-stage predictive maintenance system, and is what most actual industrial deployments start with too.
- **Status:** Implemented (`models/train_baseline.py`, model artifact saved to `models/baseline_isolation_forest.joblib`).

### Layer 4 — Explainability
- Planned: SHAP `TreeExplainer` (or `KernelExplainer` if the model isn't tree-based) to attribute the anomaly score to specific input features (e.g., "82% of this score driven by 4.2kHz band energy").
- **Status:** Not yet wired into the API. This is the next concrete build step.

### Layer 5 — Trust Index (designed, not built)
- Intended formula sketch: `trust = f(model_confidence, historical_precedent, data_quality)`
  - `model_confidence`: raw anomaly score / prediction probability.
  - `historical_precedent`: how often a similar feature pattern preceded a confirmed failure in this fleet's history (requires a feedback/labeling loop — see below).
  - `data_quality`: penalizes predictions made on sparse or low-quality sensor windows (important for real Indian field connectivity conditions).
- This is the layer that differentiates "alerts" from "trusted actions," and is explicitly called out as **not implemented** — it requires labeled feedback data that doesn't exist yet.

### Layer 6 — Action Recommendation Engine (designed, not built)
- Intent: map (anomaly type + trust score + urgency) → a concrete recommended action and time window, using a small rules table initially (not a black-box model), since action recommendations need to be auditable by maintenance engineers.

### Layer 7 — API / Presentation
- FastAPI service exposing a `/predict` endpoint.
- **Status:** Implemented — health check + prediction endpoint accepting feature input and returning an anomaly score.

## 2. Data Flow Diagram

See the Mermaid diagram in the main [README.md](../README.md#4-workflow).

## 3. Why these design choices

- **Unsupervised baseline before supervised model:** Indian heavy-machinery fleets rarely have clean, labeled failure histories. Building on unsupervised anomaly detection first is the technically honest path, not a shortcut.
- **Rules-based Action Engine before ML-based:** Maintenance recommendations carry real cost and safety implications. A rules table that a maintenance engineer can read and override is more deployable than an opaque model, at least in v1.
- **OEM-agnostic schema:** Indian sites run mixed fleets; locking into one OEM's data format would limit real-world applicability.
