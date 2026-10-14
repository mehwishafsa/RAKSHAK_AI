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
WORKDIR /app
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY backend/ backend/
COPY models/ models/
COPY --from=web /web/dist frontend/dist
RUN mkdir -p /data && useradd --system --uid 10001 rakshak && chown rakshak /data
USER rakshak
VOLUME ["/data"]
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s CMD python -c "import urllib.request,os;urllib.request.urlopen(f'http://127.0.0.1:{os.environ[\"PORT\"]}/health')"
# Single worker on purpose: the simulation engine is in-process state.
CMD ["sh", "-c", "uvicorn backend.app:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*'"]
