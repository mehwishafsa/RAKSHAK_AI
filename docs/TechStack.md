# Technology Stack

## Purpose of this document
Justifies every technology choice. No tool is listed because it "looks impressive" — each one is tied to a concrete requirement.

## Backend
- **FastAPI** — chosen over Flask/Django for built-in async support, automatic OpenAPI docs (useful for a judge or future integrator to explore the API without extra documentation effort), and type-validated request/response models via Pydantic.
- **Uvicorn** — ASGI server to run FastAPI.

## Modeling
- **scikit-learn** — `IsolationForest` as the baseline anomaly detector. Chosen because it requires no labeled failure data (which doesn't exist yet for this project) and is a standard, explainable-enough starting point used widely in real industrial anomaly detection.
- **SHAP** (planned integration) — for per-prediction feature attribution. Chosen over LIME for better consistency guarantees on tree-based models and wider industry adoption in predictive maintenance literature.
- **NumPy / pandas** — feature engineering and data handling.

## Data
- **CWRU Bearing Dataset** (Case Western Reserve University) — the de facto standard public benchmark for bearing fault vibration data. Planned for Phase 2 to replace synthetic data with a real, peer-reviewed dataset.
- **MIMII Dataset** (sound-based industrial machine anomaly) — considered for the acoustic-sensing extension.
- **Synthetic vibration generator** — used *now*, in `notebooks/`, to validate the feature-extraction → model pipeline before real data is integrated. This is explicitly a stand-in, not a claim of real-world validation.

## Frontend (planned, Phase 5)
- **React** — chosen for component reusability and because it's the most common frontend choice in the kind of dashboards judges will compare this against, minimizing unnecessary risk on UI tooling so effort can stay on the ML/decision layer.

## Testing
- **pytest** + **httpx** (FastAPI's recommended test client) for API tests.

## Deployment (planned)
- **Docker** — containerizing the FastAPI service. Not yet implemented; listed in the roadmap because a working containerized service is a meaningfully higher credibility bar than a script.

## Deliberately not used (and why)
- **No deep learning framework (PyTorch/TensorFlow) yet.** With no large labeled real-world failure dataset currently available, a deep model would be unjustifiable complexity. This will be revisited only if/when real labeled data volume justifies it.
- **No Kubernetes, no microservices.** At prototype stage, a single FastAPI service is the honest scope. Multi-service architecture would be premature and project nothing but unnecessary complexity to a judge who knows what they're looking at.
