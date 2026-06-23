"""
backend/app.py

Rakshak AI prediction API (prototype stage).

Exposes:
  GET  /health    - basic liveness check
  POST /predict    - takes extracted vibration features, returns the baseline
                     model's anomaly score.

NOTE on scope (read this before assuming more exists than does):
  - This endpoint expects pre-extracted features (rms, kurtosis, crest_factor,
    high_band_energy), not raw signal. Feature extraction matching this API
    lives in models/train_baseline.py and notebooks/01_synthetic_vibration_eda.ipynb.
  - This endpoint does NOT yet return a SHAP explanation or a Trust Index.
    Both are designed (see docs/Architecture.md) but not implemented.

Run:
    uvicorn backend.app:app --reload --port 8000
Then visit:
    http://127.0.0.1:8000/docs
"""

import os
import joblib
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

app = FastAPI(
    title="Rakshak AI - Prediction API",
    description="Prototype anomaly-scoring API for Rakshak AI. See docs/Architecture.md for full system design.",
    version="0.1.0",
)

MODEL_PATH = os.path.join(os.path.dirname(__file__), "..", "models", "baseline_isolation_forest.joblib")
_model_bundle = None  # lazy-loaded


def get_model_bundle():
    global _model_bundle
    if _model_bundle is None:
        if not os.path.exists(MODEL_PATH):
            raise HTTPException(
                status_code=503,
                detail="Model artifact not found. Run `python models/train_baseline.py` first.",
            )
        _model_bundle = joblib.load(MODEL_PATH)
    return _model_bundle


class VibrationFeatures(BaseModel):
    rms: float = Field(..., description="Root mean square of the vibration signal window")
    kurtosis: float = Field(..., description="Kurtosis of the signal window (impulsiveness indicator)")
    crest_factor: float = Field(..., description="Peak amplitude / RMS ratio")
    high_band_energy: float = Field(..., description="FFT energy above 200Hz (defect-impact band)")


class PredictionResponse(BaseModel):
    anomaly_score: float = Field(..., description="Higher = more anomalous. Not yet calibrated to a 0-1 trust scale.")
    is_anomaly: bool
    note: str = "Raw model output only. SHAP explanation and Trust Index are not yet implemented (see docs/Architecture.md)."


@app.get("/health")
def health():
    return {"status": "ok", "service": "rakshak-ai-prediction-api", "version": "0.1.0"}


@app.post("/predict", response_model=PredictionResponse)
def predict(features: VibrationFeatures):
    bundle = get_model_bundle()
    model = bundle["model"]
    feature_cols = bundle["feature_cols"]

    row = [[getattr(features, col) for col in feature_cols]]
    raw_prediction = model.predict(row)[0]  # -1 = anomaly, 1 = normal
    score = float(-model.score_samples(row)[0])  # higher = more anomalous

    return PredictionResponse(
        anomaly_score=score,
        is_anomaly=(raw_prediction == -1),
    )
