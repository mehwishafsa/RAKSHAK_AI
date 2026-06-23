"""
backend/tests/test_app.py

Basic API tests. Run with:
    pytest backend/tests/test_app.py
"""

from fastapi.testclient import TestClient
from backend.app import app

client = TestClient(app)


def test_health_check():
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"


def test_predict_returns_anomaly_score():
    payload = {
        "rms": 0.9,
        "kurtosis": 5.0,
        "crest_factor": 4.0,
        "high_band_energy": 50.0,
    }
    response = client.post("/predict", json=payload)
    assert response.status_code == 200
    body = response.json()
    assert "anomaly_score" in body
    assert isinstance(body["is_anomaly"], bool)


def test_predict_rejects_missing_fields():
    response = client.post("/predict", json={"rms": 0.9})
    assert response.status_code == 422  # FastAPI/Pydantic validation error
