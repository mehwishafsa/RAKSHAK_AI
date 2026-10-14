.PHONY: dev test test-backend test-frontend build docker docker-run seed reseed

dev:            ## API + Vite dev servers (http://localhost:5173)
	./scripts/dev.sh

test: test-backend test-frontend

test-backend:
	.venv/bin/python -m pytest

test-frontend:
	cd frontend && npm test && npx tsc -b

build:          ## build the SPA so FastAPI serves everything on :8000
	cd frontend && npm run build

seed:
	.venv/bin/python -m backend.rakshak.seed

reseed:         ## wipe the DB (ledger, incidents, stock) and reseed — do this before a live demo
	.venv/bin/python -m backend.rakshak.seed --reset

docker:
	docker build -t rakshak-ai .

docker-run:
	docker run --rm -p 8000:8000 -v rakshak-data:/data rakshak-ai
