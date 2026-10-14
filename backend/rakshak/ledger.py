"""
Trust Ledger: append-only, hash-chained audit log.

Each entry's hash = SHA-256(prev_hash || canonical JSON of the entry's fields).
Changing or removing any historical row breaks every hash after it, which
`verify()` detects. SQLite triggers additionally refuse UPDATE / DELETE.
(This is tamper-evidence inside one database, not a distributed blockchain.)
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone

from .db import Database, dumps

GENESIS_HASH = "0" * 64


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def entry_hash(prev_hash: str, fields: dict) -> str:
    return hashlib.sha256((prev_hash + dumps(fields)).encode("utf-8")).hexdigest()


def _hashed_fields(row: dict) -> dict:
    return {
        "ts": row["ts"],
        "machine_id": row["machine_id"],
        "incident_id": row["incident_id"],
        "event_type": row["event_type"],
        "actor": row["actor"],
        "source": row["source"],
        "summary": row["summary"],
        "payload": row["payload"] if isinstance(row["payload"], str) else dumps(row["payload"]),
    }


class Ledger:
    def __init__(self, db: Database) -> None:
        self.db = db

    def append(
        self,
        *,
        machine_id: str,
        event_type: str,
        actor: str,
        summary: str,
        payload: dict | None = None,
        incident_id: str | None = None,
        source: str = "live",
        ts: str | None = None,
    ) -> dict:
        row = {
            "ts": ts or utcnow(),
            "machine_id": machine_id,
            "incident_id": incident_id,
            "event_type": event_type,
            "actor": actor,
            "source": source,
            "summary": summary,
            "payload": dumps(payload or {}),
        }
        with self.db.transaction() as conn:
            last = conn.execute("SELECT hash FROM ledger ORDER BY seq DESC LIMIT 1").fetchone()
            prev = last["hash"] if last else GENESIS_HASH
            h = entry_hash(prev, _hashed_fields(row))
            cur = conn.execute(
                "INSERT INTO ledger (ts, machine_id, incident_id, event_type, actor, source, summary, payload, prev_hash, hash)"
                " VALUES (?,?,?,?,?,?,?,?,?,?)",
                (*row.values(), prev, h),
            )
            seq = cur.lastrowid
        return self._decode({**row, "seq": seq, "prev_hash": prev, "hash": h})

    @staticmethod
    def _decode(row: dict) -> dict:
        out = dict(row)
        out["payload"] = json.loads(row["payload"]) if isinstance(row["payload"], str) else row["payload"]
        return out

    def list(self, limit: int = 200, incident_id: str | None = None) -> list[dict]:
        if incident_id:
            rows = self.db.query(
                "SELECT * FROM ledger WHERE incident_id = ? ORDER BY seq DESC LIMIT ?", (incident_id, limit)
            )
        else:
            rows = self.db.query("SELECT * FROM ledger ORDER BY seq DESC LIMIT ?", (limit,))
        return [self._decode(r) for r in rows]

    def head(self) -> dict:
        row = self.db.one("SELECT COUNT(*) AS n, MAX(seq) AS seq FROM ledger")
        last = self.db.one("SELECT hash FROM ledger ORDER BY seq DESC LIMIT 1")
        return {"count": row["n"], "last_seq": row["seq"] or 0, "last_hash": last["hash"] if last else GENESIS_HASH}

    def verify(self) -> dict:
        prev = GENESIS_HASH
        count = 0
        for row in self.db.query("SELECT * FROM ledger ORDER BY seq ASC"):
            count += 1
            if row["prev_hash"] != prev:
                return {"valid": False, "checked": count, "broken_at_seq": row["seq"], "reason": "prev_hash mismatch"}
            if entry_hash(prev, _hashed_fields(row)) != row["hash"]:
                return {"valid": False, "checked": count, "broken_at_seq": row["seq"], "reason": "hash mismatch"}
            prev = row["hash"]
        return {"valid": True, "checked": count, "broken_at_seq": None, "reason": None, "head_hash": prev}
