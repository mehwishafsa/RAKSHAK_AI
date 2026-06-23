# Competitive Analysis

## Purpose of this document
An honest look at existing players, rather than a claim that "no one else does this." Judges can and will check this; overclaiming novelty is one of the fastest ways to lose credibility in a pitch.

## Existing categories of solutions

### 1. OEM-native predictive maintenance (e.g., Siemens MindSphere/Insights Hub, GE Digital's Predix-based offerings, Caterpillar's VisionLink, Tata Hitachi's ConSite)
- **Strength:** Deep integration with their own equipment, large historical fleet data.
- **Limitation Rakshak AI targets:** Locked to a single OEM. A mixed-fleet Indian site (common in construction/mining) gets a separate, non-interoperable dashboard per brand, and none of them explain *why* in a way a field technician trusts.

### 2. General industrial IoT analytics platforms (e.g., PTC ThingWorx, AWS IoT predictive maintenance templates, Azure IoT + ML reference architectures)
- **Strength:** Flexible, cloud-scale, well-documented.
- **Limitation Rakshak AI targets:** These are platforms/toolkits, not opinionated decision-support products. They give you the building blocks for anomaly detection but not an "action layer" tuned to field-technician trust and Indian connectivity/skill constraints — that integration work is left to the implementer.

### 3. Academic / research predictive maintenance systems
- **Strength:** Often technically sophisticated (deep learning on benchmark datasets like CWRU).
- **Limitation Rakshak AI targets:** Optimized for benchmark accuracy, not for the explainability-to-action gap. Rarely designed with low-connectivity, mixed-skill field deployment in mind.

## Where Rakshak AI's actual differentiation is (and isn't)

**Being honest:** Rakshak AI is *not* claiming a novel ML algorithm. Isolation Forest, SHAP, and rules-based recommendation engines all exist and are well-studied individually.

**The actual claim:** the combination — explainability + a precedent-weighted Trust Index + an auditable action engine, packaged specifically for OEM-mixed, lower-connectivity Indian field conditions — is not something the current OEM-native or generic-IoT-platform offerings package together out of the box.

## Honest risks to this positioning
- A well-resourced OEM (Siemens, GE, Tata Hitachi) could add an explainability layer to their existing predictive maintenance product faster than a startup can build the full action-recommendation layer from scratch.
- "Cross-OEM" is a hard sales/integration problem, not just a technical one — getting data access across competing OEM platforms has business, not just engineering, friction.

This document should be revisited and updated as real competitor research deepens — it is a starting framework, not a final answer.
