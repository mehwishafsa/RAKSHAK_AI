# Workflow

## Purpose of this document
Walks through the end-to-end lifecycle of a single prediction, from raw sensor reading to (eventually) a technician action — and is explicit about which steps exist today versus which are planned.

## End-to-end walkthrough

1. **Sensor reading arrives.**
   A vibration/temperature/acoustic sample is captured at the machine.
   *Current state: simulated via the synthetic data generator in `notebooks/`. No live sensor integration yet.*

2. **Normalization.**
   Raw signal is mapped into the common schema (`machine_id`, `sensor_type`, `timestamp`, `value`, `unit`) regardless of source OEM format.
   *Current state: schema defined in `docs/Architecture.md`; not yet enforced by a live ingestion service.*

3. **Feature extraction.**
   A rolling window of readings is converted into statistical + frequency-domain features (RMS, kurtosis, FFT band energy).
   *Current state: implemented in the EDA notebook and the training script.*

4. **Model scoring.**
   Features are passed to the trained `IsolationForest` baseline, producing an anomaly score.
   *Current state: implemented and exposed via the FastAPI `/predict` endpoint.*

5. **Explainability (planned next step).**
   SHAP values would attribute the score to specific features, so the output isn't just a number.
   *Current state: not implemented. This is the highest-priority next build item.*

6. **Trust Index (planned).**
   Combines model confidence with historical precedent and data quality into a single trust score.
   *Current state: designed only — requires a feedback/labeling dataset that doesn't exist yet.*

7. **Action recommendation (planned).**
   A small, auditable rules table converts (anomaly type, trust score, urgency) into a concrete recommended action and time window.
   *Current state: designed only.*

8. **Technician-facing output (planned).**
   Plain-language alert with the explanation and recommended action, surfaced via the (not-yet-built) frontend.
   *Current state: the API currently returns a raw JSON score — no UI layer yet.*

9. **Feedback loop (planned).**
   Technician marks the alert as "confirmed fault" or "false alarm." This label feeds back into the Trust Index over time.
   *Current state: not implemented — this is what would turn Rakshak AI from a static model into a learning system.*

## Why this sequencing matters

Steps 1–4 are the parts every predictive-maintenance prototype builds. Steps 5–9 are where Rakshak AI's actual thesis ("turning predictions into trusted actions") lives — and they are deliberately sequenced *after* a working baseline, rather than mocked up to look complete. The roadmap in `docs/FutureRoadmap.md` builds these in that order.
