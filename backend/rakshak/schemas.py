"""Typed request / response contracts for the REST API (mirrored in frontend/src/types.ts)."""

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, StringConstraints

Scenario = Literal["bearing", "overheating", "lubrication"]

# Identities and reasons are stripped before length checks, so "   " is rejected (422)
# rather than recorded as an empty, unattributable actor.
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
Reason = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]
Note = Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)]


class ScenarioRequest(BaseModel):
    scenario: Scenario


class SpeedRequest(BaseModel):
    speed: float = Field(..., description="Simulation speed multiplier: 0.5, 1, 2 or 4")


class ActorRequest(BaseModel):
    actor: Name = "operator"


class ApproveRequest(BaseModel):
    approver: Name = Field(..., description="Name / ID of the approving engineer")
    note: Note = ""


class RejectRequest(BaseModel):
    approver: Name
    reason: Reason = Field(..., description="Why the proposed action is rejected")


class LedgerEntry(BaseModel):
    seq: int
    ts: str
    machine_id: str
    incident_id: str | None
    event_type: str
    actor: str
    source: Literal["live", "simulation-control", "seed-sample"]
    summary: str
    payload: dict[str, Any]
    prev_hash: str
    hash: str


class LedgerVerification(BaseModel):
    valid: bool
    checked: int
    broken_at_seq: int | None
    reason: str | None
    head_hash: str | None = None


class Part(BaseModel):
    sku: str
    name: str
    unit: str
    qty_on_hand: float
    reorder_level: float
    location: str


class Incident(BaseModel):
    id: str
    machine_id: str
    created_at: str
    updated_at: str
    status: Literal["AWAITING_APPROVAL", "IN_PROGRESS", "VERIFYING", "RESOLVED", "REJECTED", "CANCELLED", "INTERRUPTED"]
    risk: Literal["LOW", "MEDIUM", "CRITICAL"]
    anomaly_score: float
    fault: dict[str, Any]
    explanation: dict[str, Any]
    action: dict[str, Any]
    decided_by: str | None = None
    decided_at: str | None = None
    decision_note: str | None = None
    work_order: str | None = None
    outcome: dict[str, Any] | None = None


class OkResponse(BaseModel):
    ok: bool = True
    detail: str = ""
