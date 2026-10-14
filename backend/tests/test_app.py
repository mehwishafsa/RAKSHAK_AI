"""API + full incident-lifecycle tests. Run with:  pytest backend"""

from .conftest import run_until


def test_health_check(client):
    r = client.get("/health")
    assert r.status_code == 200 and r.json()["status"] == "ok"


def test_state_has_live_frame_on_startup(client):
    body = client.get("/api/state").json()
    assert body["machine"]["id"] == "CD-07"
    assert body["last"]["simulated"] is True
    assert body["last"]["detection"]["risk"] == "LOW"
    assert body["baseline"]["windows"] == 60


def test_inventory_and_ledger_endpoints(client):
    assert any(p["sku"] == "BRG-6312-2RS" for p in client.get("/api/inventory").json())
    assert client.get("/api/ledger").status_code == 200
    assert client.get("/api/ledger/verify").json()["valid"] is True


def test_invalid_controls(client):
    assert client.post("/api/sim/scenario", json={"scenario": "meteor"}).status_code == 422
    assert client.post("/api/sim/speed", json={"speed": 3}).status_code == 409
    assert client.post("/api/sim/speed", json={"speed": 2}).status_code == 200
    assert client.get("/api/incidents/INC-9999").status_code == 404


def open_incident(client, scenario="bearing"):
    assert client.post("/api/sim/scenario", json={"scenario": scenario}).status_code == 200
    msg = run_until(client.engine, lambda m: m["incident"] is not None)
    return msg["incident"]


def test_fault_opens_incident_awaiting_approval(client):
    inc = open_incident(client)
    assert inc["status"] == "AWAITING_APPROVAL"
    assert inc["fault"]["code"] == "BEARING_DEFECT"
    assert inc["fault"]["component"] == "bearing_3"
    assert inc["action"]["inventory"]["all_available"] is True
    events = [e["event_type"] for e in client.get("/api/ledger", params={"incident_id": inc["id"]}).json()]
    assert events[::-1] == ["FAULT_DETECTED", "EXPLANATION_GENERATED", "ACTION_PROPOSED"]
    # Nothing executed yet: machine still running, stock untouched.
    assert client.engine.state == "RUNNING"
    stock = {p["sku"]: p["qty_on_hand"] for p in client.get("/api/inventory").json()}
    assert stock["BRG-6312-2RS"] == 4


def test_approve_runs_full_loop_to_verified_outcome(client):
    inc = open_incident(client)
    r = client.post(f"/api/incidents/{inc['id']}/approve", json={"approver": "R. Sharma", "note": "go"})
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "IN_PROGRESS" and body["work_order"].startswith("WO-")
    stock = {p["sku"]: p["qty_on_hand"] for p in client.get("/api/inventory").json()}
    assert stock["BRG-6312-2RS"] == 3

    # Approving twice is refused.
    assert client.post(f"/api/incidents/{inc['id']}/approve", json={"approver": "x"}).status_code == 409

    run_until(client.engine, lambda m: m["incident"]["status"] == "RESOLVED", max_ticks=300)
    final = client.get(f"/api/incidents/{inc['id']}").json()
    assert final["outcome"]["verified"] is True
    assert final["outcome"]["post_repair_anomaly_score"] < 0.3

    events = [e["event_type"] for e in client.get("/api/ledger", params={"incident_id": inc["id"]}).json()][::-1]
    assert events[0] == "FAULT_DETECTED"
    assert events[-4:] == ["HUMAN_APPROVED", "WORK_ORDER_DISPATCHED", "MAINTENANCE_COMPLETED", "OUTCOME_VERIFIED"]
    assert client.get("/api/ledger/verify").json()["valid"] is True


def test_reject_requires_reason_and_suppresses_realert(client):
    inc = open_incident(client, "lubrication")
    assert client.post(f"/api/incidents/{inc['id']}/reject", json={"approver": "A", "reason": ""}).status_code == 422
    r = client.post(f"/api/incidents/{inc['id']}/reject", json={"approver": "A", "reason": "Oil top-up done manually"})
    assert r.status_code == 200 and r.json()["status"] == "REJECTED"
    ledger = client.get("/api/ledger", params={"incident_id": inc["id"]}).json()
    assert ledger[0]["event_type"] == "HUMAN_REJECTED" and ledger[0]["actor"] == "A"
    # Machine keeps running, nothing reserved.
    assert client.engine.state == "RUNNING"
    stock = {p["sku"]: p["qty_on_hand"] for p in client.get("/api/inventory").json()}
    assert stock["OIL-VG320"] == 45


def test_rejected_at_medium_realerts_when_critical(client):
    eng = client.engine
    client.post("/api/sim/scenario", json={"scenario": "overheating"})
    msg = run_until(eng, lambda m: m["incident"] is not None)
    first = msg["incident"]
    assert first["risk"] == "MEDIUM"
    client.post(f"/api/incidents/{first['id']}/reject", json={"approver": "A", "reason": "monitor for now"})
    msg = run_until(eng, lambda m: m["incident"] and m["incident"]["id"] != first["id"])
    assert msg["incident"]["risk"] == "CRITICAL"


def test_reset_cancels_open_incident(client):
    inc = open_incident(client)
    client.post("/api/sim/reset")
    assert client.get(f"/api/incidents/{inc['id']}").json()["status"] == "CANCELLED"
    msg = client.engine.step()
    assert msg["incident"] is None and msg["machine"]["injected_scenario"] is None


def test_estop_pauses_detection_and_blocks_injection(client):
    r = client.post("/api/sim/estop", json={"actor": "operator"})
    assert r.status_code == 200
    msg = run_until(client.engine, lambda m: m["machine"]["rpm"] < 100)
    assert msg["detection"]["risk"] == "OFFLINE"
    assert client.post("/api/sim/scenario", json={"scenario": "bearing"}).status_code == 409
    assert client.get("/api/ledger").json()[0]["event_type"] == "EMERGENCY_STOP"


def test_websocket_streams_frames(client):
    with client.websocket_connect("/ws/telemetry") as ws:
        frame = ws.receive_json()
    assert frame["type"] == "telemetry"
    assert set(frame["readings"]) >= {"vibration_rms", "temperature", "pressure", "oil_quality"}
    assert len(frame["waveform"]) > 50


def test_ledger_persists_across_restart(tmp_path):
    from fastapi.testclient import TestClient

    from backend.app import create_app
    from backend.rakshak.config import Settings

    settings = Settings(db_path=tmp_path / "p.db", frontend_dist=tmp_path / "none")
    with TestClient(create_app(settings, run_loop=False)) as c:
        c.post("/api/sim/estop", json={"actor": "persist-test"})
        n = len(c.get("/api/ledger").json())
    with TestClient(create_app(settings, run_loop=False)) as c:
        entries = c.get("/api/ledger").json()
        assert len(entries) == n
        assert any(e["actor"] == "persist-test" for e in entries)
        assert c.get("/api/ledger/verify").json()["valid"] is True


def test_legacy_predict_validation(client):
    assert client.post("/predict", json={"rms": 0.9}).status_code == 422


def test_restart_with_open_incident_closes_it_as_interrupted(tmp_path):
    from fastapi.testclient import TestClient

    from backend.app import create_app
    from backend.rakshak.config import Settings

    settings = Settings(db_path=tmp_path / "r.db", frontend_dist=tmp_path / "none")
    app = create_app(settings, run_loop=False)
    with TestClient(app) as c:
        c.engine = app.state.engine
        inc = open_incident(c)
    with TestClient(create_app(settings, run_loop=False)) as c:
        assert c.get(f"/api/incidents/{inc['id']}").json()["status"] == "INTERRUPTED"
        assert c.get("/api/ledger").json()[0]["event_type"] == "INCIDENT_INTERRUPTED"
        assert c.get("/api/state").json()["incident"] is None
