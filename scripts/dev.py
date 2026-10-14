#!/usr/bin/env python3
"""
One-command dev run for Rakshak AI — works on macOS, Linux and Windows.

    python3 scripts/dev.py          (macOS / Linux)
    py scripts\\dev.py               (Windows)

Starts FastAPI (hot reload) and the Vite dev server together, then prints the URL
to open (http://localhost:5173 by default). Ctrl+C stops both.

What it checks and does, so failures are explicit instead of mysterious:
  * Python 3.10 – 3.14 (the pinned dependencies ship wheels for exactly that range)
  * Node.js 18+ and npm
  * creates / repairs .venv and installs requirements only when they change
  * installs frontend/node_modules when package-lock.json changes
  * if port 8000 / 5173 is taken, uses the next free port (and points Vite's proxy at the API)
"""

from __future__ import annotations

import hashlib
import os
import shutil
import signal
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"
VENV = ROOT / ".venv"
MIN_PY, MAX_PY = (3, 10), (3, 14)
MIN_NODE = 18
IS_WIN = os.name == "nt"


def fail(msg: str) -> "None":
    print(f"\n\033[31m✗ {msg}\033[0m\n", file=sys.stderr)
    sys.exit(1)


def info(msg: str) -> None:
    print(f"\033[36m›\033[0m {msg}", flush=True)


def check_python() -> None:
    v = sys.version_info[:2]
    if not (MIN_PY <= v <= MAX_PY):
        hint = (
            "Install Python 3.12 (https://www.python.org/downloads/ or `brew install python@3.12`) "
            "and run:  python3.12 scripts/dev.py"
            if not IS_WIN
            else "Install Python 3.12 from python.org and run:  py -3.12 scripts\\dev.py"
        )
        fail(f"Python {v[0]}.{v[1]} found ({sys.executable}); Rakshak AI needs Python 3.10 – 3.14.\n  {hint}")


def venv_python() -> Path:
    return VENV / ("Scripts/python.exe" if IS_WIN else "bin/python")


def ensure_venv() -> Path:
    py = venv_python()
    if py.exists():
        try:
            out = subprocess.run(
                [str(py), "-c", "import sys; print('%d.%d' % sys.version_info[:2])"],
                capture_output=True, text=True, check=True,
            ).stdout.strip()
            major, minor = (int(x) for x in out.split("."))
            if not (MIN_PY <= (major, minor) <= MAX_PY):
                info(f".venv uses unsupported Python {out}; recreating it")
                shutil.rmtree(VENV)
        except (subprocess.CalledProcessError, ValueError, OSError):
            info(".venv is broken; recreating it")
            shutil.rmtree(VENV, ignore_errors=True)
    if not py.exists():
        info(f"Creating .venv with Python {sys.version.split()[0]}")
        subprocess.run([sys.executable, "-m", "venv", str(VENV)], check=True)

    reqs = (ROOT / "requirements.txt").read_bytes() + (ROOT / "backend" / "requirements.txt").read_bytes()
    stamp = VENV / ".rakshak-requirements"
    digest = hashlib.sha256(reqs).hexdigest()
    if not stamp.exists() or stamp.read_text() != digest:
        info("Installing Python dependencies (first run takes ~30 s)")
        subprocess.run([str(py), "-m", "pip", "install", "-q", "--upgrade", "pip"], check=True)
        r = subprocess.run([str(py), "-m", "pip", "install", "-q", "-r", str(ROOT / "requirements.txt")])
        if r.returncode != 0:
            fail("pip install failed (see the error above).")
        stamp.write_text(digest)
    return py


def ensure_node() -> str:
    npm = shutil.which("npm")
    node = shutil.which("node")
    if not node or not npm:
        fail("Node.js 18+ (with npm) is required: https://nodejs.org/")
    version = subprocess.run([node, "--version"], capture_output=True, text=True).stdout.strip()
    try:
        major = int(version.lstrip("v").split(".")[0])
    except ValueError:
        major = 0
    if major < MIN_NODE:
        fail(f"Node.js {version} found; Vite needs Node.js {MIN_NODE}+ (https://nodejs.org/).")

    lock = FRONTEND / "package-lock.json"
    stamp = FRONTEND / "node_modules" / ".rakshak-lock"
    digest = hashlib.sha256(lock.read_bytes()).hexdigest()
    if not stamp.exists() or stamp.read_text() != digest:
        info("Installing frontend dependencies (npm ci)")
        r = subprocess.run([npm, "ci", "--no-audit", "--no-fund"], cwd=FRONTEND)
        if r.returncode != 0:
            fail("npm ci failed (see the error above).")
        stamp.write_text(digest)
    return npm


def port_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            s.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False


def pick_port(preferred: int, what: str) -> int:
    for port in range(preferred, preferred + 20):
        if port_free(port):
            if port != preferred:
                info(f"Port {preferred} is busy; using {port} for the {what}")
            return port
    fail(f"No free port found in {preferred}–{preferred + 19}.")
    return preferred


def load_dotenv(env: dict) -> None:
    path = ROOT / ".env"
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            env.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def wait_for_health(port: int, proc: subprocess.Popen, timeout: float = 60) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if proc.poll() is not None:
            fail("The API server exited during startup (see the error above).")
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=1) as r:
                if r.status == 200:
                    return
        except OSError:
            pass
        time.sleep(0.3)
    fail(f"The API did not become healthy on port {port} within {timeout:.0f}s.")


def terminate(proc: subprocess.Popen) -> None:
    if proc.poll() is not None:
        return
    try:
        if IS_WIN:
            subprocess.run(["taskkill", "/F", "/T", "/PID", str(proc.pid)], capture_output=True)
        else:
            os.killpg(proc.pid, signal.SIGTERM)
        proc.wait(timeout=5)
    except Exception:
        proc.kill()


def main() -> None:
    os.chdir(ROOT)
    check_python()
    py = ensure_venv()
    npm = ensure_node()

    env = dict(os.environ)
    load_dotenv(env)
    api_port = pick_port(int(env.get("RAKSHAK_API_PORT", "8000")), "API")
    web_port = pick_port(int(env.get("RAKSHAK_WEB_PORT", "5173")), "web UI")
    env["RAKSHAK_BACKEND_URL"] = f"http://127.0.0.1:{api_port}"
    group = {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP} if IS_WIN else {"start_new_session": True}

    info(f"Starting API on http://127.0.0.1:{api_port}")
    api = subprocess.Popen(
        [str(py), "-m", "uvicorn", "backend.app:app", "--reload", "--reload-dir", "backend", "--port", str(api_port)],
        env=env, **group,
    )
    procs = [api]
    try:
        wait_for_health(api_port, api)
        info("Starting Vite dev server")
        web = subprocess.Popen(
            [npm, "run", "dev", "--", "--port", str(web_port), "--strictPort"], cwd=FRONTEND, env=env, **group
        )
        procs.append(web)
        print(f"\n\033[32m✓ Rakshak AI is running — open http://localhost:{web_port} (Ctrl+C to stop)\033[0m\n", flush=True)
        while all(p.poll() is None for p in procs):
            time.sleep(0.5)
        fail("A dev server exited unexpectedly (see the output above).")
    except KeyboardInterrupt:
        print("\nStopping…")
    finally:
        for p in procs:
            terminate(p)


if __name__ == "__main__":
    main()
