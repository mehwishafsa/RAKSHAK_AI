"""Runtime configuration, read from environment variables (see .env.example)."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[2]


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    db_path: Path = field(
        default_factory=lambda: Path(os.environ.get("RAKSHAK_DB_PATH", ROOT_DIR / "data" / "rakshak.db"))
    )
    frontend_dist: Path = field(
        default_factory=lambda: Path(os.environ.get("RAKSHAK_FRONTEND_DIST", ROOT_DIR / "frontend" / "dist"))
    )
    # Wall-clock seconds between simulation ticks (5 Hz by default).
    tick_seconds: float = field(default_factory=lambda: _env_float("RAKSHAK_TICK_SECONDS", 0.2))
    # Seed for the simulator's RNG, so a demo run is reproducible.
    sim_seed: int = field(default_factory=lambda: int(_env_float("RAKSHAK_SIM_SEED", 7)))
    cors_origins: tuple[str, ...] = field(
        default_factory=lambda: tuple(
            o.strip() for o in os.environ.get("RAKSHAK_CORS_ORIGINS", "http://localhost:5173").split(",") if o.strip()
        )
    )


def get_settings() -> Settings:
    return Settings()
