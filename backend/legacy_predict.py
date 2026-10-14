"""
Legacy endpoint from the first prototype: POST /predict scores pre-extracted
vibration features with the IsolationForest baseline in models/ (trained on
synthetic data by models/train_baseline.py).

It is kept for continuity but is NOT part of the live digital-twin loop, which
uses the transparent rule-based detector in backend/rakshak/detection.py.
scikit-learn / joblib are optional: without them this endpoint returns 503.
"""

import os

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter(tags=["legacy"])

MODEL_PATH = os.path.join(os.path.dirname(__file__), "..", "models", "baseline_isolation_forest.joblib")
_model_bundle = None  # lazy-loaded


def get_model_bundle():
    global _model_bundle
    if _model_bundle is None:
        try:
            import joblib
        except ImportError:
            raise HTTPException(status_code=503, detail="joblib / scikit-learn not installed (see requirements-ml.txt).")
        if not os.path.exists(MODEL_PATH):
            raise HTTPException(
                status_code=503,
                detail="Model artifact not found. Run `python models/train_baseline.py` first.",
            )
        try:
            _model_bundle = joblib.load(MODEL_PATH)
        except Exception as exc:  # e.g. scikit-learn version mismatch with the pickled model
            raise HTTPException(status_code=503, detail=f"Could not load model artifact: {exc}")
    return _model_bundle


class VibrationFeatures(BaseModel):
    rms: float = Field(..., description="Root mean square of the vibration signal window")
    kurtosis: float = Field(..., description="Kurtosis of the signal window (impulsiveness indicator)")
    crest_factor: float = Field(..., description="Peak amplitude / RMS ratio")
    high_band_energy: float = Field(..., description="FFT energy above 200Hz (defect-impact band)")


class PredictionResponse(BaseModel):
    anomaly_score: float = Field(..., description="Higher = more anomalous. Not yet calibrated to a 0-1 trust scale.")
    is_anomaly: bool
    note: str = "Raw IsolationForest output (synthetic training data). Not used by the live digital-twin loop."


@router.post("/predict", response_model=PredictionResponse)
def predict(features: VibrationFeatures):
    bundle = get_model_bundle()
    model = bundle["model"]
    feature_cols = bundle["feature_cols"]

    row = [[getattr(features, col) for col in feature_cols]]
    raw_prediction = model.predict(row)[0]  # -1 = anomaly, 1 = normal
    score = float(-model.score_samples(row)[0])  # higher = more anomalous

    return PredictionResponse(anomaly_score=score, is_anomaly=(raw_prediction == -1))
