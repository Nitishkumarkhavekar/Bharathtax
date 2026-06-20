# TaxMedha — common operations. (See README for details.)
COMPOSE = docker compose

.PHONY: up down logs build migrate revision seed ingest verify-corpus test fmt

up:            ## start core stack (CPU)
	$(COMPOSE) up -d --build

down:          ## stop stack
	$(COMPOSE) down

logs:          ## tail logs
	$(COMPOSE) logs -f --tail=100

build:         ## rebuild images
	$(COMPOSE) build

migrate:       ## apply DB migrations
	$(COMPOSE) run --rm api alembic upgrade head

revision:      ## autogenerate a migration:  make revision m="add x"
	$(COMPOSE) run --rm api alembic revision --autogenerate -m "$(m)"

seed:          ## create admin + demo wings/seats
	$(COMPOSE) run --rm api python -m app.scripts.seed

ingest:        ## run Workstream B pipeline over enabled sources
	$(COMPOSE) run --rm worker python -m app.ingestion.pipeline run

verify-corpus: ## assert chunks/embeddings/indexes exist
	$(COMPOSE) run --rm api python -m app.ingestion.pipeline verify

test:          ## run backend tests
	$(COMPOSE) run --rm api pytest -q

fmt:           ## format backend
	$(COMPOSE) run --rm api ruff format app
