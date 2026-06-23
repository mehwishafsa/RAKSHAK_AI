# FAQ

**Q: Is this a working product?**
No. This is an early prototype / concept validation stage project. The backend API and baseline anomaly model are real and working. The Trust Index, Action Recommendation Engine, and frontend are designed but not yet built. See the status table in the main [README.md](../README.md#6-current-status).

**Q: What data is this trained on right now?**
A synthetic vibration signal generator (sine wave + noise + injected fault impulses), built to validate the feature-extraction and modeling pipeline before real datasets are integrated. It is not a substitute for real validation — see `datasets/README.md` for the plan to integrate the CWRU bearing dataset.

**Q: Why isn't there a frontend yet?**
Because the harder and more differentiated problem — explainability and trust scoring — comes before the UI in the build sequence. A polished dashboard over an unexplainable black-box score would be the wrong thing to prioritize at this stage.

**Q: Why Isolation Forest and not a deep learning model?**
There's no large labeled real-world failure dataset for this project yet. Deep learning needs either large labeled data or significant unsupervised pretraining infrastructure — neither is justified at this stage. Isolation Forest is a standard, defensible unsupervised baseline used in real industrial anomaly detection. See `docs/TechStack.md` for the full reasoning.

**Q: What happens if the model is wrong?**
This is exactly why the Action Recommendation Engine is designed as a rules table reviewable by a maintenance engineer, not an opaque model — and why the Trust Index exists at all: to communicate *how much* to trust a given alert, not just produce a flag. Today, the API output is a raw score, with no Trust Index yet — this is an explicit, called-out gap.

**Q: How is this different from [OEM]'s existing predictive maintenance dashboard?**
See `docs/CompetitiveAnalysis.md` for the full comparison. Short version: most existing tools are locked to one OEM's fleet and stop at "alert," without an explainability or action layer tuned for mixed-fleet, lower-connectivity Indian sites.

**Q: What's the single biggest open risk?**
Getting access to real labeled failure data from an actual Indian heavy-machinery fleet. Without it, the Trust Index cannot be properly validated, and the project's core claim — "trusted actions, not just alerts" — remains a design rather than a demonstrated capability. This is the most important next step, ahead of any further code.
