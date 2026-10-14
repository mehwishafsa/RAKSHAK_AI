"""
Seed the SQLite database with the demo machine, a parts inventory and a few
SAMPLE ledger entries (source = "seed-sample", clearly labelled in the UI).

    python -m backend.rakshak.seed            # seed if empty
    python -m backend.rakshak.seed --reset    # delete the DB file and reseed
"""

from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone

from .config import get_settings
from .db import Database
from .ledger import Ledger

MACHINE = {
    "id": "CD-07",
    "name": "Conveyor Drive CD-07",
    "site": "Simulated site — Line 2, raw-material yard",
    "model": "75 kW induction motor + helical gearbox + drive pulley",
    "commissioned": "2023-04-01",
}

PARTS = [
    # sku, name, unit, qty, reorder level, location
    ("BRG-6312-2RS", "Deep-groove ball bearing 6312-2RS", "ea", 4, 2, "Store A / Rack 3"),
    ("GRS-LGHP2-0.4", "High-performance bearing grease 0.4 kg", "ea", 6, 3, "Store A / Rack 1"),
    ("SEAL-OR-110", "O-ring seal 110 mm", "ea", 10, 4, "Store A / Rack 2"),
    ("FAN-180M-AX", "Motor cooling fan, frame 180M", "ea", 2, 1, "Store B / Bay 1"),
    ("FLT-AIR-180", "Fan-cowl air filter", "ea", 5, 2, "Store B / Bay 1"),
    ("FLT-OIL-G320", "Gearbox oil filter element", "ea", 3, 2, "Store A / Rack 4"),
    ("OIL-VG320", "Gear oil ISO VG 320", "L", 45, 30, "Lube room / Drum 2"),
    ("GSK-PUMP-45", "Oil pump gasket", "ea", 1, 2, "Store A / Rack 4"),
]


def _sample_history(ledger: Ledger, machine_id: str) -> None:
    """Three sample entries showing the ledger format. Labelled seed-sample."""
    base = datetime.now(timezone.utc) - timedelta(days=6, hours=3)
    rows = [
        (0, "SYSTEM_COMMISSIONED", "seed-script", "Rakshak AI monitoring enabled for CD-07 (sample entry)", {}),
        (
            41,
            "INSPECTION_LOGGED",
            "seed-script",
            "Routine inspection recorded: belt tension adjusted (sample entry)",
            {"note": "Sample data created by the seed script, not a real inspection."},
        ),
        (
            97,
            "BASELINE_REVIEWED",
            "seed-script",
            "Healthy-operation baseline reviewed (sample entry)",
            {"note": "Sample data created by the seed script."},
        ),
    ]
    for minutes, event, actor, summary, payload in rows:
        ledger.append(
            machine_id=machine_id,
            event_type=event,
            actor=actor,
            summary=summary,
            payload=payload,
            source="seed-sample",
            ts=(base + timedelta(minutes=minutes)).isoformat(timespec="milliseconds"),
        )


def seed(db: Database) -> bool:
    """Seed an empty database. Returns True if anything was inserted."""
    if db.one("SELECT id FROM machines WHERE id = ?", (MACHINE["id"],)):
        return False
    db.execute(
        "INSERT INTO machines (id, name, site, model, commissioned) VALUES (:id, :name, :site, :model, :commissioned)",
        MACHINE,  # type: ignore[arg-type]
    )
    for row in PARTS:
        db.execute(
            "INSERT OR REPLACE INTO parts (sku, name, unit, qty_on_hand, reorder_level, location) VALUES (?,?,?,?,?,?)",
            row,
        )
    if Ledger(db).head()["count"] == 0:
        _sample_history(Ledger(db), MACHINE["id"])
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--reset", action="store_true", help="delete the database file first")
    args = parser.parse_args()
    path = get_settings().db_path
    if args.reset:
        for suffix in ("", "-wal", "-shm"):
            p = path.with_name(path.name + suffix)
            if p.exists():
                p.unlink()
    db = Database(path)
    print(f"{'Seeded' if seed(db) else 'Already seeded'}: {path}")


if __name__ == "__main__":
    main()
