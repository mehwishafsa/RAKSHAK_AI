"""
Rakshak AI — FastAPI service.

  WS   /ws/telemetry                    live telemetry + detection frames (5 Hz)
  GET  /api/state                       machine, baseline, speeds, latest frame
  POST /api/sim/scenario                inject a simulated fault  {scenario}
  POST /api/sim/reset                   reset simulation to healthy
  POST /api/sim/speed                   set simulation speed      {speed}
  POST /api/sim/estop                   emergency stop (latches)  {actor}
  POST /api/sim/release                 release a latched e-stop  {actor}
  GET  /api/incidents                   recent incidents
  GET  /api/incidents/{id}              one incident
  POST /api/incidents/{id}/approve      human approval            {approver, note}
  POST /api/incidents/{id}/reject       human rejection           {approver, reason}
  GET  /api/ledger                      trust ledger (newest first)
  GET  /api/ledger/verify               recompute the hash chain
  GET  /api/inventory                   parts inventory
  GET  /health                          liveness
  POST /predict                         legacy IsolationForest endpoint (see legacy_predict.py)

In production the same process serves the built React app from frontend/dist.

Run (dev):  uvicorn backend.app:app --reload --port 8000
"""

from __future__ import annotations

import asyncio
import contextlib
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .legacy_predict import router as legacy_router
from .rakshak import schemas
from .rakshak.config import Settings, get_settings
from .rakshak.db import Database
from .rakshak.engine import ControlError, Engine, NotFound
from .rakshak.ledger import Ledger
from .rakshak.seed import seed

VERSION = "0.2.0"


def create_app(settings: Settings | None = None, run_loop: bool = True) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        db = Database(settings.db_path)
        seed(db)
        engine = Engine(db, seed=settings.sim_seed, tick_seconds=settings.tick_seconds)
        engine.step()  # never serve an empty first frame
        app.state.db = db
        app.state.engine = engine
        task = asyncio.create_task(engine.run()) if run_loop else None
        try:
            yield
        finally:
            if task:
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await task
            db.close()

    app = FastAPI(
        title="Rakshak AI",
        description="Explainable predictive maintenance + trusted action. Simulation-driven proof of concept.",
        version=VERSION,
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware, allow_origins=list(settings.cors_origins), allow_methods=["*"], allow_headers=["*"]
    )

    def engine() -> Engine:
        return app.state.engine

    def guard(fn, *args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except ControlError as exc:
            raise HTTPException(status_code=409, detail=str(exc))
        except NotFound as exc:
            raise HTTPException(status_code=404, detail=f"not found: {exc}")

    @app.get("/health")
    def health():
        return {"status": "ok", "service": "rakshak-ai", "version": VERSION}

    @app.get("/api/state")
    def state():
        return engine().state_summary()

    @app.post("/api/sim/scenario", response_model=schemas.OkResponse)
    def inject(req: schemas.ScenarioRequest):
        guard(engine().inject, req.scenario)
        return schemas.OkResponse(detail=f"{req.scenario} injected")

    @app.post("/api/sim/reset", response_model=schemas.OkResponse)
    def reset():
        engine().reset()
        return schemas.OkResponse(detail="reset to healthy")

    @app.post("/api/sim/speed", response_model=schemas.OkResponse)
    def speed(req: schemas.SpeedRequest):
        guard(engine().set_speed, req.speed)
        return schemas.OkResponse(detail=f"speed {req.speed}x")

    @app.post("/api/sim/estop", response_model=schemas.OkResponse)
    def estop(req: schemas.ActorRequest):
        engine().emergency_stop(req.actor)
        return schemas.OkResponse(detail="emergency stop")

    @app.post("/api/sim/release", response_model=schemas.OkResponse)
    def release(req: schemas.ActorRequest):
        guard(engine().release_estop, req.actor)
        return schemas.OkResponse(detail="emergency stop released")

    @app.get("/api/incidents", response_model=list[schemas.Incident])
    def incidents(limit: int = 20):
        return engine().list_incidents(min(max(limit, 1), 200))

    @app.get("/api/incidents/{incident_id}", response_model=schemas.Incident)
    def incident(incident_id: str):
        return guard(engine().get_incident, incident_id)

    @app.post("/api/incidents/{incident_id}/approve", response_model=schemas.Incident)
    def approve(incident_id: str, req: schemas.ApproveRequest):
        return guard(engine().approve, incident_id, req.approver, req.note)

    @app.post("/api/incidents/{incident_id}/reject", response_model=schemas.Incident)
    def reject(incident_id: str, req: schemas.RejectRequest):
        return guard(engine().reject, incident_id, req.approver, req.reason)

    @app.get("/api/ledger", response_model=list[schemas.LedgerEntry])
    def ledger(limit: int = 200, incident_id: str | None = None):
        return Ledger(app.state.db).list(min(max(limit, 1), 1000), incident_id)

    @app.get("/api/ledger/verify", response_model=schemas.LedgerVerification)
    def verify():
        return Ledger(app.state.db).verify()

    @app.get("/api/inventory", response_model=list[schemas.Part])
    def inventory():
        return app.state.db.query("SELECT * FROM parts ORDER BY sku")

    @app.websocket("/ws/telemetry")
    async def telemetry(ws: WebSocket):
        await ws.accept()
        eng = engine()
        q = eng.subscribe()
        try:
            if eng.last_message:
                await ws.send_json(eng.last_message)
            while True:
                await ws.send_json(await q.get())
        except (WebSocketDisconnect, RuntimeError):
            pass
        finally:
            eng.unsubscribe(q)

    app.include_router(legacy_router)

    # ---- single-service deploy: serve the built SPA ------------------------
    dist = settings.frontend_dist
    if (dist / "index.html").exists():
        if (dist / "assets").is_dir():
            app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

        @app.get("/{path:path}", include_in_schema=False)
        def spa(path: str):
            if path.startswith(("api/", "ws/")):
                return JSONResponse({"detail": "Not Found"}, status_code=404)
            candidate = (dist / path).resolve()
            if path and candidate.is_file() and dist.resolve() in candidate.parents:
                return FileResponse(candidate)
            return FileResponse(dist / "index.html")
    else:

        @app.get("/", include_in_schema=False)
        def root():
            return {"service": "rakshak-ai", "detail": "Frontend not built. Run `npm run build` in frontend/ or use the Vite dev server."}

    return app


app = create_app()
