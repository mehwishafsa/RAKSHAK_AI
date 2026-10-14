# Base images are overridable, e.g. --build-arg PYTHON_IMAGE=mirror.gcr.io/library/python:3.12-slim
ARG NODE_IMAGE=node:22-alpine
ARG PYTHON_IMAGE=python:3.12-slim

# ---- Stage 1: build the React app -------------------------------------------
FROM ${NODE_IMAGE} AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ---- Stage 2: FastAPI service that also serves the built SPA ----------------
FROM ${PYTHON_IMAGE}
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    RAKSHAK_DB_PATH=/data/rakshak.db \
    RAKSHAK_FRONTEND_DIST=/app/frontend/dist \
    PORT=8000
# PORT: Render injects its own value (10000) at runtime; 8000 is the local default.
WORKDIR /app
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY backend/ backend/
COPY models/ models/
COPY --from=web /web/dist frontend/dist
# /data holds the SQLite file. It is writable by the app user; mount a volume there
# (docker compose does) to keep the ledger across container restarts. On Render's
# free plan it is ephemeral: reset on redeploy, restart or idle spin-down.
RUN mkdir -p /data && useradd --system --uid 10001 rakshak && chown rakshak /data
USER rakshak
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s CMD python -c "import urllib.request,os;urllib.request.urlopen(f'http://127.0.0.1:{os.environ[\"PORT\"]}/health')"
# Single worker on purpose: the simulation engine is in-process state.
# `exec` makes uvicorn PID 1 so it receives SIGTERM and shuts down cleanly on redeploy.
CMD ["sh", "-c", "exec uvicorn backend.app:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'"]
