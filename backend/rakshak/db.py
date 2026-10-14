"""SQLite storage: machines, parts inventory, incidents and the append-only trust ledger."""

from __future__ import annotations

import json
import sqlite3
import threading
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS machines (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    site        TEXT NOT NULL,
    model       TEXT NOT NULL,
    commissioned TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS parts (
    sku           TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    unit          TEXT NOT NULL,
    qty_on_hand   REAL NOT NULL CHECK (qty_on_hand >= 0),
    reorder_level REAL NOT NULL,
    location      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS incidents (
    id            TEXT PRIMARY KEY,
    machine_id    TEXT NOT NULL REFERENCES machines(id),
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    status        TEXT NOT NULL,
    risk          TEXT NOT NULL,
    anomaly_score REAL NOT NULL,
    fault         TEXT NOT NULL,   -- JSON
    explanation   TEXT NOT NULL,   -- JSON
    action        TEXT NOT NULL,   -- JSON
    decided_by    TEXT,
    decided_at    TEXT,
    decision_note TEXT,
    work_order    TEXT,
    outcome       TEXT              -- JSON
);

-- The trust ledger is append-only: every row carries the SHA-256 of its
-- predecessor, and triggers reject any UPDATE or DELETE.
CREATE TABLE IF NOT EXISTS ledger (
    seq         INTEGER PRIMARY KEY AUTOINCREMENT,
    ts          TEXT NOT NULL,
    machine_id  TEXT NOT NULL,
    incident_id TEXT,
    event_type  TEXT NOT NULL,
    actor       TEXT NOT NULL,
    source      TEXT NOT NULL,      -- live | simulation-control | seed-sample
    summary     TEXT NOT NULL,
    payload     TEXT NOT NULL,      -- JSON
    prev_hash   TEXT NOT NULL,
    hash        TEXT NOT NULL UNIQUE
);

CREATE TRIGGER IF NOT EXISTS ledger_no_update BEFORE UPDATE ON ledger
BEGIN SELECT RAISE(ABORT, 'trust ledger is append-only'); END;

CREATE TRIGGER IF NOT EXISTS ledger_no_delete BEFORE DELETE ON ledger
BEGIN SELECT RAISE(ABORT, 'trust ledger is append-only'); END;
"""


class Database:
    """Thin thread-safe wrapper around a single SQLite connection."""

    def __init__(self, path: Path | str) -> None:
        self.path = str(path)
        if self.path != ":memory:":
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(self.path, check_same_thread=False, isolation_level=None)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA foreign_keys = ON")
        if self.path != ":memory:":
            self.conn.execute("PRAGMA journal_mode = WAL")
        self.lock = threading.RLock()
        self.conn.executescript(SCHEMA)

    def query(self, sql: str, params: tuple = ()) -> list[dict]:
        with self.lock:
            return [dict(r) for r in self.conn.execute(sql, params).fetchall()]

    def one(self, sql: str, params: tuple = ()) -> dict | None:
        rows = self.query(sql, params)
        return rows[0] if rows else None

    def execute(self, sql: str, params: tuple = ()) -> sqlite3.Cursor:
        with self.lock:
            return self.conn.execute(sql, params)

    def transaction(self):
        return _Tx(self)

    def close(self) -> None:
        self.conn.close()


class _Tx:
    def __init__(self, db: Database) -> None:
        self.db = db

    def __enter__(self) -> sqlite3.Connection:
        self.db.lock.acquire()
        self.db.conn.execute("BEGIN IMMEDIATE")
        return self.db.conn

    def __exit__(self, exc_type, exc, tb) -> None:
        try:
            self.db.conn.execute("ROLLBACK" if exc_type else "COMMIT")
        finally:
            self.db.lock.release()


def dumps(obj) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
