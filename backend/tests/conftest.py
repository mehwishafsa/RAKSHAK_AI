import pytest
from fastapi.testclient import TestClient

from backend.app import create_app
from backend.rakshak.config import Settings
from backend.rakshak.db import Database
from backend.rakshak.seed import seed


@pytest.fixture
def db():
    d = Database(":memory:")
    seed(d)
    yield d
    d.close()


@pytest.fixture
def client(tmp_path):
    """App with the background tick loop disabled; tests advance time via engine.step()."""
    settings = Settings(db_path=tmp_path / "test.db", frontend_dist=tmp_path / "no-dist", tick_seconds=0.2, sim_seed=7)
    app = create_app(settings, run_loop=False)
    with TestClient(app) as c:
        c.engine = app.state.engine
        yield c


def run_until(engine, predicate, max_ticks=200):
    for _ in range(max_ticks):
        msg = engine.step()
        if predicate(msg):
            return msg
    raise AssertionError("condition not reached")
