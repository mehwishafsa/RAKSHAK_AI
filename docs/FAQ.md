# FAQ

**Q: Is this a working product?**
No. It is a **simulation-driven proof of concept**. What runs end-to-end today: a 3D digital twin driven by a simulated sensor stream, real rule-based detection / classification / feature-contribution explanations computed on that stream, a rule-template action engine with an inventory check, a human approval gate, and an append-only hash-chained trust ledger persisted in SQLite. Not built yet: a trained model in the live loop, SHAP, the Trust Index, real IoT ingestion. See "What's built vs. what's designed next" in the main [README.md](../README.md).

**Q: What data is this trained on right now?**
A synthetic vibration signal generator (sine wave + noise + injected fault impulses), built to validate the feature-extraction and modeling pipeline before real datasets are integrated. It is not a substitute for real validation — see `datasets/README.md` for the plan to integrate the CWRU bearing dataset.

**Q: Why does the live demo use rules instead of the IsolationForest model?**
Because every number on screen must be traceable in a technical Q&A. The rules (EWMA smoothing, z-score against a commissioning baseline, severity scaled to engineering trip limits, IF-THEN fault rules) are fully documented in `backend/rakshak/detection.py` and unit-tested. The IsolationForest baseline (trained on synthetic data) is still available at `POST /predict`, but it is not used in the twin loop, and no accuracy is claimed for either.

**Q: Is the explanation SHAP?**
No, and the UI says so. It is a rule/feature-contribution explanation: each signal's share of the total severity. SHAP on a trained model is a planned next step.

**Q: Why Isolation Forest and not a deep learning model?**
There's no large labeled real-world failure dataset for this project yet. Deep learning needs either large labeled data or significant unsupervised pretraining infrastructure — neither is justified at this stage. Isolation Forest is a standard, defensible unsupervised baseline used in real industrial anomaly detection. See `docs/TechStack.md` for the full reasoning.

**Q: What happens if the model is wrong?**
This is exactly why the Action Recommendation Engine is designed as a rules table reviewable by a maintenance engineer, not an opaque model — and why the Trust Index exists at all: to communicate *how much* to trust a given alert, not just produce a flag. In the prototype, nothing is executed until a named engineer approves; a rejection is logged with its reason and the system only re-alerts if risk escalates. The Trust Index is still an explicit, called-out gap.

**Q: How is this different from [OEM]'s existing predictive maintenance dashboard?**
See `docs/CompetitiveAnalysis.md` for the full comparison. Short version: most existing tools are locked to one OEM's fleet and stop at "alert," without an explainability or action layer tuned for mixed-fleet, lower-connectivity Indian sites.

**Q: What's the single biggest open risk?**
Getting access to real labeled failure data from an actual Indian heavy-machinery fleet. Without it, the Trust Index cannot be properly validated, and the project's core claim — "trusted actions, not just alerts" — remains a design rather than a demonstrated capability. This is the most important next step, ahead of any further code.
