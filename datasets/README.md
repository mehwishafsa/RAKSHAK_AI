# datasets/

This project deliberately does **not** check large dataset binaries into the repository.

## In use now
- **Synthetic vibration data** — generated on the fly inside `notebooks/01_synthetic_vibration_eda.ipynb` (sine wave + Gaussian noise + injected fault impulses). Used only to validate the feature-extraction → model pipeline before real data is integrated. Not a claim of real-world validated performance.

## Planned (Phase 2)
- **CWRU Bearing Dataset** — Case Western Reserve University's public bearing fault vibration dataset. The standard benchmark for bearing fault classification. Download instructions will be added here once integrated; the raw files are not committed to git (use `.gitignore` / Git LFS if needed).
- **MIMII Dataset** — public industrial machine sound dataset, under consideration for the acoustic-sensing extension.

## Why no real data yet
Honest reason: no real, labeled failure data from an actual Indian heavy-machinery fleet currently exists for this project. This is the single biggest open dependency for the project's core claim (see `docs/FAQ.md`). Using public benchmark datasets (CWRU/MIMII) in Phase 2 is the realistic bridge until real fleet data partnerships materialize.
