# Future Roadmap

## Purpose of this document
A phased, realistic build plan. Each phase has a concrete exit criterion — not a vague aspiration — so progress can be verified.

## Phase 1 — Documentation (✅ Complete)
Architecture, workflow, tech stack, and competitive positioning documented honestly, including explicit gaps.
**Exit criterion:** This repository.

## Phase 2 — Dataset + EDA
- Integrate the CWRU bearing dataset (real, public, peer-reviewed) to replace the synthetic generator.
- Optionally integrate the MIMII acoustic dataset for the sound-based anomaly extension.
- Re-run the feature extraction notebook against real data and compare against synthetic-data results.
**Exit criterion:** Notebook with real CWRU data producing feature distributions that visibly separate normal vs. faulty bearing samples.

## Phase 3 — Model
- Re-train the baseline model on real CWRU features.
- Wire in SHAP explainability so every prediction returns top contributing features, not just a score.
- Evaluate against CWRU's labeled fault categories (inner race / outer race / ball fault) as a sanity check, even though the production use case is unsupervised.
**Exit criterion:** A model + SHAP explanation pipeline, with a short written evaluation of accuracy/limitations against CWRU labels.

## Phase 4 — Backend
- Expand the FastAPI service: persist predictions, add a basic feedback endpoint (`confirmed_fault` / `false_alarm`).
- Begin building the Trust Index using whatever feedback/precedent data exists by this point (synthetic feedback if real feedback isn't available yet — clearly labeled as such).
**Exit criterion:** API returns a prediction + SHAP explanation + a first-version Trust Index score.

## Phase 5 — Frontend
- Minimal React dashboard: list of machines, current anomaly status, explanation, and (once built) recommended action.
- Deliberately not a feature-rich dashboard — the goal is demonstrating the explainability/trust output, not UI breadth.
**Exit criterion:** A working page that shows a prediction with its explanation in plain language.

## Phase 6 — Integration
- Containerize the backend (Docker).
- Connect frontend to backend end-to-end.
- Build the first version of the Action Recommendation Engine as a rules table driven by (anomaly type, Trust Index, urgency).
**Exit criterion:** End-to-end demo: synthetic or CWRU-replayed sensor data → prediction → explanation → trust score → recommended action, shown in the frontend.

## Beyond Phase 6 (not committed, exploratory)
- Pilot with a real fleet's sensor feed, if a data-sharing partnership becomes available (e.g., through InnoVent/Tata Technologies connections).
- Multi-OEM schema validation with at least two distinct real telemetry formats.
- Feedback-driven Trust Index retraining loop.
