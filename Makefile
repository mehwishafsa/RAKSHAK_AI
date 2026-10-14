.PHONY: dev test test-backend test-frontend build docker docker-run seed reseed

dev:            ## API + Vite dev servers (http://localhost:5173); Windows: py scripts\dev.py
	./scripts/dev.sh

test: test-backend test-frontend

PY := $(if $(wildcard .venv/Scripts/python.exe),.venv/Scripts/python.exe,.venv/bin/python)

test-backend:
	$(PY) -m pytest

test-frontend:
	cd frontend && npm test && npx tsc -b

build:          ## build the SPA so FastAPI serves everything on :8000
	cd frontend && npm run build

seed:
	$(PY) -m backend.rakshak.seed

reseed:         ## (server stopped) wipe the DB (ledger, incidents, stock) and reseed — do this before a live demo
	$(PY) -m backend.rakshak.seed --reset

docker:
	docker build -t rakshak-ai .

docker-run:
	docker run --rm -p 8000:8000 -v rakshak-data:/data rakshak-ai
