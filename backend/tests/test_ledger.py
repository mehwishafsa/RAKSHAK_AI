import sqlite3

import pytest

from backend.rakshak.actions import build_action, check_inventory
from backend.rakshak.ledger import GENESIS_HASH, Ledger


def test_seed_creates_machine_parts_and_sample_entries(db):
    assert db.one("SELECT id FROM machines")["id"] == "CD-07"
    assert len(db.query("SELECT * FROM parts")) >= 8
    entries = Ledger(db).list()
    assert entries and all(e["source"] == "seed-sample" for e in entries)


def test_hash_chain_links_entries(db):
    ledger = Ledger(db)
    a = ledger.append(machine_id="CD-07", event_type="A", actor="t", summary="a")
    b = ledger.append(machine_id="CD-07", event_type="B", actor="t", summary="b", payload={"x": 1})
    assert b["prev_hash"] == a["hash"]
    assert ledger.verify()["valid"] is True
    assert ledger.head()["last_hash"] == b["hash"]


def test_first_entry_chains_from_genesis():
    from backend.rakshak.db import Database

    d = Database(":memory:")
    e = Ledger(d).append(machine_id="X", event_type="A", actor="t", summary="a")
    assert e["prev_hash"] == GENESIS_HASH


def test_ledger_rejects_update_and_delete(db):
    Ledger(db).append(machine_id="CD-07", event_type="A", actor="t", summary="a")
    with pytest.raises(sqlite3.IntegrityError, match="append-only"):
        db.execute("UPDATE ledger SET summary = 'tampered'")
    with pytest.raises(sqlite3.IntegrityError, match="append-only"):
        db.execute("DELETE FROM ledger")


def test_verify_detects_tampering(db):
    ledger = Ledger(db)
    ledger.append(machine_id="CD-07", event_type="A", actor="t", summary="a")
    ledger.append(machine_id="CD-07", event_type="B", actor="t", summary="b")
    # Bypass the triggers the way an attacker with file access could.
    db.execute("DROP TRIGGER ledger_no_update")
    target = ledger.list()[1]["seq"]
    db.execute("UPDATE ledger SET summary = 'tampered' WHERE seq = ?", (target,))
    result = ledger.verify()
    assert result["valid"] is False
    assert result["broken_at_seq"] == target


def test_inventory_check_and_shortfall(db):
    ok = check_inventory(db, [("BRG-6312-2RS", 1)])
    assert ok["all_available"] and ok["lines"][0]["on_hand"] == 4
    short = check_inventory(db, [("GSK-PUMP-45", 3)])
    assert not short["all_available"]
    assert short["lines"][0]["shortfall"] == 2
    unknown = check_inventory(db, [("NOPE", 1)])
    assert not unknown["all_available"]


def test_build_action_from_template(db):
    fault = {"code": "LUBRICATION_FAULT", "component": "lube_system", "component_label": "Gearbox lubrication system"}
    action = build_action(db, fault, "CRITICAL")
    assert action["priority"] == "Immediate"
    assert action["technicians"] == 2 and action["est_hours"] == 2.5
    skus = {line["sku"] for line in action["inventory"]["lines"]}
    assert skus == {"FLT-OIL-G320", "OIL-VG320", "GSK-PUMP-45"}
    # Pump gasket stock (1) drops below its reorder level (2) once used.
    gasket = next(l for l in action["inventory"]["lines"] if l["sku"] == "GSK-PUMP-45")
    assert gasket["reorder_after_use"] is True
