"""
Runtime engine: ticks the simulator, runs detection, drives the incident
lifecycle and broadcasts telemetry frames to WebSocket subscribers.

Incident lifecycle (every transition is written to the trust ledger):

    risk >= MEDIUM for ALARM_DEBOUNCE consecutive windows
        -> FAULT_DETECTED, EXPLANATION_GENERATED, ACTION_PROPOSED   [AWAITING_APPROVAL]
    human approves  -> HUMAN_APPROVED, WORK_ORDER_DISPATCHED          [IN_PROGRESS]
        (parts reserved, controlled shutdown, simulated repair)
    repair done     -> MAINTENANCE_COMPLETED                          [VERIFYING]
    risk LOW for VERIFY_WINDOWS windows -> OUTCOME_VERIFIED           [RESOLVED]
    human rejects   -> HUMAN_REJECTED                                 [REJECTED]
        (same fault is only re-raised if risk escalates or after REJECT_COOLDOWN_S)

Nothing in the physical world (shutdown, part reservation, work order) happens
before a human approval.
"""

from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone

from .actions import build_action, reserve_parts
from .db import Database, dumps
from .detection import RISK_ORDER, Baseline, Detector
from .ledger import Ledger, utcnow
from .seed import MACHINE
from .simulator import SCENARIOS, MachineSimulator

ALARM_DEBOUNCE = 3
VERIFY_WINDOWS = 10
MAINTENANCE_SECONDS = 8.0  # simulated repair duration (sim time)
REJECT_COOLDOWN_S = 30.0
CALIBRATION_WINDOWS = 60
SPEEDS = (0.5, 1.0, 2.0, 4.0)

SCENARIO_LABELS = {
    "bearing": "Bearing fault",
    "overheating": "Overheating",
    "lubrication": "Lubrication fault",
}

ACTIVE_STATUSES = ("AWAITING_APPROVAL", "IN_PROGRESS", "VERIFYING")


class ControlError(Exception):
    """A control request that is not valid in the current state (HTTP 409)."""


class NotFound(Exception):
    pass


class Engine:
    def __init__(self, db: Database, seed: int = 7, tick_seconds: float = 0.2) -> None:
        self.db = db
        self.ledger = Ledger(db)
        self.tick_seconds = tick_seconds
        self.machine_id = MACHINE["id"]
        self.baseline = self._calibrate(seed + 1000)
        self.sim = MachineSimulator(seed)
        self.detector = Detector(self.baseline)
        self.speed = 1.0
        self.state = "RUNNING"  # RUNNING | E_STOP | MAINTENANCE
        self.seq = 0
        self.alarm_streak = 0
        self.verify_streak = 0
        self.maintenance_until = 0.0
        self.suppressed: dict[str, dict] = {}
        self.incident: dict | None = self._load_active_incident()
        self.last_message: dict | None = None
        self._subscribers: set[asyncio.Queue] = set()

    # ------------------------------------------------------------------ setup
    @staticmethod
    def _calibrate(seed: int) -> Baseline:
        """Learn the healthy baseline from a commissioning run of the (simulated) machine."""
        cal = MachineSimulator(seed)
        for _ in range(5):
            cal.step(0.2)
        return Baseline.from_frames(cal.step(0.2) for _ in range(CALIBRATION_WINDOWS))

    def _load_active_incident(self) -> dict | None:
        # A restart loses the in-memory simulation, so incidents left open by a
        # previous process can't be continued honestly: close them as interrupted.
        for row in self.db.query(
            f"SELECT id FROM incidents WHERE status IN ({','.join('?' * len(ACTIVE_STATUSES))})", ACTIVE_STATUSES
        ):
            self._set_incident(row["id"], status="INTERRUPTED")
            self.ledger.append(
                machine_id=self.machine_id,
                incident_id=row["id"],
                event_type="INCIDENT_INTERRUPTED",
                actor="system",
                summary=f"{row['id']} closed: service restarted before the workflow completed",
            )
        return None

    # ------------------------------------------------------------ incidents
    def _decode_incident(self, row: dict | None) -> dict | None:
        if row is None:
            return None
        out = dict(row)
        for key in ("fault", "explanation", "action", "outcome"):
            if out.get(key):
                out[key] = json.loads(out[key])
        return out

    def get_incident(self, incident_id: str) -> dict:
        inc = self._decode_incident(self.db.one("SELECT * FROM incidents WHERE id = ?", (incident_id,)))
        if inc is None:
            raise NotFound(incident_id)
        return inc

    def list_incidents(self, limit: int = 20) -> list[dict]:
        rows = self.db.query("SELECT * FROM incidents ORDER BY created_at DESC LIMIT ?", (limit,))
        return [self._decode_incident(r) for r in rows]

    def _set_incident(self, incident_id: str, **fields) -> dict:
        fields["updated_at"] = utcnow()
        for key in ("fault", "explanation", "action", "outcome"):
            if key in fields and not isinstance(fields[key], str):
                fields[key] = dumps(fields[key])
        cols = ", ".join(f"{k} = ?" for k in fields)
        self.db.execute(f"UPDATE incidents SET {cols} WHERE id = ?", (*fields.values(), incident_id))
        inc = self.get_incident(incident_id)
        if self.incident and self.incident["id"] == incident_id:
            self.incident = inc
        return inc

    def _next_id(self, prefix: str, table: str, column: str) -> str:
        row = self.db.one(f"SELECT COUNT(*) AS n FROM {table} WHERE {column} IS NOT NULL")
        return f"{prefix}{row['n'] + 1:04d}"

    def _snapshot(self, det: dict) -> dict:
        return {
            k: {"value": round(v["smoothed"], 3), "baseline": round(v["baseline"], 3), "z": v["z_score"]}
            for k, v in det["signals"].items()
        }

    def _open_incident(self, det: dict) -> None:
        fault = det["fault"]
        action = build_action(self.db, fault, det["risk"])
        explanation = {"method": det["method"], "contributions": det["contributions"], "rule": fault["rule"]}
        incident_id = self._next_id("INC-", "incidents", "id")
        now = utcnow()
        self.db.execute(
            "INSERT INTO incidents (id, machine_id, created_at, updated_at, status, risk, anomaly_score, fault, explanation, action)"
            " VALUES (?,?,?,?,?,?,?,?,?,?)",
            (
                incident_id,
                self.machine_id,
                now,
                now,
                "AWAITING_APPROVAL",
                det["risk"],
                det["anomaly_score"],
                dumps(fault),
                dumps(explanation),
                dumps(action),
            ),
        )
        self.incident = self.get_incident(incident_id)
        top = det["contributions"][0]
        common = {"machine_id": self.machine_id, "incident_id": incident_id, "actor": "rakshak-detector"}
        self.ledger.append(
            **common,
            event_type="FAULT_DETECTED",
            summary=f"{fault['label']} on {fault['component_label']} — risk {det['risk']}, "
            f"anomaly score {det['anomaly_score']:.2f}",
            payload={"fault": fault, "risk": det["risk"], "anomaly_score": det["anomaly_score"], "signals": self._snapshot(det)},
        )
        self.ledger.append(
            **common,
            event_type="EXPLANATION_GENERATED",
            summary=f"Top driver: {top['text']} ({top['share'] * 100:.0f}% of deviation)",
            payload=explanation,
        )
        inv = action["inventory"]
        self.ledger.append(
            **{**common, "actor": "rakshak-action-engine"},
            event_type="ACTION_PROPOSED",
            summary=f"{action['title']} · {action['est_hours']} h · {action['technicians']} technicians · "
            f"parts {'available' if inv['all_available'] else 'SHORT'} — awaiting human approval",
            payload=action,
        )

    def _update_open_incident(self, det: dict) -> None:
        inc = self.incident
        assert inc is not None
        fault = det["fault"]
        if inc["fault"]["code"] == "UNCLASSIFIED" and fault and fault["code"] != "UNCLASSIFIED":
            action = build_action(self.db, fault, det["risk"])
            self._set_incident(inc["id"], fault=fault, action=action)
            self.ledger.append(
                machine_id=self.machine_id,
                incident_id=inc["id"],
                event_type="FAULT_RECLASSIFIED",
                actor="rakshak-detector",
                summary=f"Reclassified as {fault['label']} ({fault['rule']})",
                payload={"fault": fault, "action": action},
            )
        if RISK_ORDER[det["risk"]] > RISK_ORDER[self.incident["risk"]]:
            fault = self.incident["fault"]
            action = build_action(self.db, fault, det["risk"])
            self._set_incident(inc["id"], risk=det["risk"], anomaly_score=det["anomaly_score"], action=action)
            self.ledger.append(
                machine_id=self.machine_id,
                incident_id=inc["id"],
                event_type="RISK_ESCALATED",
                actor="rakshak-detector",
                summary=f"Risk escalated to {det['risk']} (anomaly score {det['anomaly_score']:.2f}); "
                f"priority now {action['priority']}",
                payload={"risk": det["risk"], "anomaly_score": det["anomaly_score"], "signals": self._snapshot(det)},
            )

    def _is_suppressed(self, det: dict) -> bool:
        code = det["fault"]["code"]
        sup = self.suppressed.get(code)
        if not sup:
            return False
        if self.sim.sim_time >= sup["until"] or RISK_ORDER[det["risk"]] > RISK_ORDER[sup["risk"]]:
            del self.suppressed[code]
            return False
        return True

    # ------------------------------------------------------------------- tick
    def step(self) -> dict:
        dt = self.tick_seconds * self.speed
        frame = self.sim.step(dt)
        self.seq += 1

        if self.state == "MAINTENANCE" and self.sim.sim_time >= self.maintenance_until:
            self.sim.clear_fault()
            self.sim.start()
            self.state = "RUNNING"
            self.detector.reset()
            if self.incident and self.incident["status"] == "IN_PROGRESS":
                self._set_incident(self.incident["id"], status="VERIFYING")
                self.verify_streak = 0
                self.ledger.append(
                    machine_id=self.machine_id,
                    incident_id=self.incident["id"],
                    event_type="MAINTENANCE_COMPLETED",
                    actor="maintenance-crew (simulated)",
                    summary=f"{self.incident['work_order']} completed; machine restarted, verifying signals",
                )

        active = self.state == "RUNNING" and self.sim.running
        if active:
            det = self.detector.update(frame)
            self._drive_lifecycle(det)
        else:
            det = {
                "anomaly_score": 0.0,
                "risk": "OFFLINE",
                "fault": None,
                "contributions": [],
                "signals": {},
                "method": "detection paused: machine not at operating speed",
            }

        msg = {
            "type": "telemetry",
            "seq": self.seq,
            "ts": datetime.now(timezone.utc).isoformat(timespec="milliseconds"),
            "sim_time": frame.sim_time,
            "speed": self.speed,
            "simulated": True,
            "machine": {
                "id": self.machine_id,
                "name": MACHINE["name"],
                "state": self.state,
                "rpm": frame.rpm,
                "injected_scenario": self.sim.scenario,
            },
            "readings": {
                "vibration_rms": round(frame.vibration_rms, 3),
                "vibration_peak": round(frame.vibration_peak, 3),
                "kurtosis": round(frame.kurtosis, 3),
                "crest_factor": round(frame.crest_factor, 3),
                "temperature": round(frame.temperature, 2),
                "pressure": round(frame.pressure, 3),
                "oil_quality": round(frame.oil_quality, 2),
            },
            "waveform": frame.waveform,
            "detection": det,
            "incident": self.incident,
            "ledger_head": self.ledger.head(),
        }
        self.last_message = msg
        return msg

    def _drive_lifecycle(self, det: dict) -> None:
        elevated = RISK_ORDER[det["risk"]] >= RISK_ORDER["MEDIUM"]
        self.alarm_streak = self.alarm_streak + 1 if elevated else 0
        inc = self.incident
        status = inc["status"] if inc else None

        if status == "AWAITING_APPROVAL" and elevated:
            self._update_open_incident(det)
        elif status == "VERIFYING":
            self.verify_streak = 0 if elevated else self.verify_streak + 1
            if self.verify_streak >= VERIFY_WINDOWS:
                outcome = {
                    "verified": True,
                    "windows": VERIFY_WINDOWS,
                    "post_repair_anomaly_score": det["anomaly_score"],
                    "signals": self._snapshot(det),
                }
                self._set_incident(inc["id"], status="RESOLVED", outcome=outcome)
                self.ledger.append(
                    machine_id=self.machine_id,
                    incident_id=inc["id"],
                    event_type="OUTCOME_VERIFIED",
                    actor="rakshak-detector",
                    summary=f"Fault cleared: risk LOW for {VERIFY_WINDOWS} consecutive windows, "
                    f"post-repair anomaly score {det['anomaly_score']:.2f}",
                    payload=outcome,
                )
        elif status not in ACTIVE_STATUSES and self.alarm_streak >= ALARM_DEBOUNCE and det["fault"]:
            if not self._is_suppressed(det):
                self._open_incident(det)

    # --------------------------------------------------------------- controls
    def _require_incident(self, incident_id: str, status: str) -> dict:
        inc = self.get_incident(incident_id)
        if inc["status"] != status:
            raise ControlError(f"{incident_id} is {inc['status']}, expected {status}")
        return inc

    def approve(self, incident_id: str, actor: str, note: str = "") -> dict:
        inc = self._require_incident(incident_id, "AWAITING_APPROVAL")
        work_order = self._next_id(f"WO-{datetime.now(timezone.utc):%Y}-", "incidents", "work_order")
        with self.db.transaction() as conn:
            reserved = reserve_parts(conn, inc["action"]["inventory"])
        now = utcnow()
        inc = self._set_incident(
            incident_id, status="IN_PROGRESS", decided_by=actor, decided_at=now, decision_note=note, work_order=work_order
        )
        self.incident = inc
        self.ledger.append(
            machine_id=self.machine_id,
            incident_id=incident_id,
            event_type="HUMAN_APPROVED",
            actor=actor,
            summary=f"Approved: {inc['action']['title']}" + (f" — “{note}”" if note else ""),
            payload={"note": note, "risk_at_approval": inc["risk"]},
        )
        self.ledger.append(
            machine_id=self.machine_id,
            incident_id=incident_id,
            event_type="WORK_ORDER_DISPATCHED",
            actor="rakshak-action-engine",
            summary=f"{work_order} dispatched; {len(reserved)} part line(s) reserved; controlled shutdown initiated",
            payload={"work_order": work_order, "reserved": reserved, "shortfalls": [
                line for line in inc["action"]["inventory"]["lines"] if not line["available"]
            ]},
        )
        self.sim.stop()
        self.state = "MAINTENANCE"
        self.maintenance_until = self.sim.sim_time + MAINTENANCE_SECONDS
        self.alarm_streak = 0
        return inc

    def reject(self, incident_id: str, actor: str, reason: str) -> dict:
        if not reason.strip():
            raise ControlError("a reason is required to reject an action")
        inc = self._require_incident(incident_id, "AWAITING_APPROVAL")
        inc = self._set_incident(
            incident_id, status="REJECTED", decided_by=actor, decided_at=utcnow(), decision_note=reason
        )
        self.suppressed[inc["fault"]["code"]] = {"risk": inc["risk"], "until": self.sim.sim_time + REJECT_COOLDOWN_S}
        self.ledger.append(
            machine_id=self.machine_id,
            incident_id=incident_id,
            event_type="HUMAN_REJECTED",
            actor=actor,
            summary=f"Rejected: “{reason}” — no action executed; will re-alert if risk escalates",
            payload={"reason": reason, "risk_at_rejection": inc["risk"], "cooldown_s": REJECT_COOLDOWN_S},
        )
        return inc

    def inject(self, scenario: str, actor: str = "demo-presenter") -> None:
        if scenario not in SCENARIOS:
            raise ControlError(f"unknown scenario {scenario!r}")
        if self.state != "RUNNING":
            raise ControlError(f"machine is {self.state}; reset to healthy first")
        if self.incident and self.incident["status"] in ("IN_PROGRESS", "VERIFYING"):
            raise ControlError(f"{self.incident['id']} repair is in progress; wait for verification or reset")
        self.sim.inject(scenario)
        self.ledger.append(
            machine_id=self.machine_id,
            event_type="SCENARIO_INJECTED",
            actor=actor,
            source="simulation-control",
            summary=f"Demo control: simulated {SCENARIO_LABELS[scenario].lower()} injected into sensor stream",
            payload={"scenario": scenario},
        )

    def reset(self, actor: str = "demo-presenter") -> None:
        if self.incident and self.incident["status"] in ACTIVE_STATUSES:
            self._set_incident(self.incident["id"], status="CANCELLED")
            self.ledger.append(
                machine_id=self.machine_id,
                incident_id=self.incident["id"],
                event_type="INCIDENT_CANCELLED",
                actor=actor,
                source="simulation-control",
                summary=f"{self.incident['id']} cancelled by simulation reset",
            )
        self.sim.reset()
        self.detector.reset()
        self.state = "RUNNING"
        self.alarm_streak = 0
        self.verify_streak = 0
        self.suppressed.clear()
        self.incident = None
        self.ledger.append(
            machine_id=self.machine_id,
            event_type="SIMULATION_RESET",
            actor=actor,
            source="simulation-control",
            summary="Demo control: simulation reset to healthy operation",
        )

    def emergency_stop(self, actor: str = "operator") -> None:
        if self.state == "E_STOP":
            return
        self.sim.stop()
        self.state = "E_STOP"
        self.alarm_streak = 0
        self.ledger.append(
            machine_id=self.machine_id,
            incident_id=self.incident["id"] if self.incident and self.incident["status"] in ACTIVE_STATUSES else None,
            event_type="EMERGENCY_STOP",
            actor=actor,
            summary="Emergency stop pressed — drive coasting to standstill; detection paused",
        )

    def set_speed(self, speed: float) -> None:
        if speed not in SPEEDS:
            raise ControlError(f"speed must be one of {SPEEDS}")
        self.speed = speed

    def state_summary(self) -> dict:
        return {
            "machine": {**MACHINE, "state": self.state},
            "speed": self.speed,
            "speeds": list(SPEEDS),
            "scenarios": [{"id": k, "label": v} for k, v in SCENARIO_LABELS.items()],
            "baseline": {
                "windows": self.baseline.windows,
                "mean": {k: round(v, 4) for k, v in self.baseline.mean.items()},
                "std": {k: round(v, 4) for k, v in self.baseline.std.items()},
            },
            "tick_seconds": self.tick_seconds,
            "incident": self.incident,
            "last": self.last_message,
        }

    # -------------------------------------------------------------- streaming
    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=20)
        self._subscribers.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self._subscribers.discard(q)

    def _broadcast(self, msg: dict) -> None:
        for q in list(self._subscribers):
            if q.full():
                try:
                    q.get_nowait()
                except asyncio.QueueEmpty:
                    pass
            q.put_nowait(msg)

    async def run(self) -> None:
        loop = asyncio.get_running_loop()
        next_tick = loop.time()
        while True:
            try:
                self._broadcast(self.step())
            except Exception:  # keep the demo alive; surface the error in logs
                import logging

                logging.getLogger("rakshak").exception("engine tick failed")
            next_tick += self.tick_seconds
            await asyncio.sleep(max(0.0, next_tick - loop.time()))
