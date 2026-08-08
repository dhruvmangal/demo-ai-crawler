.PHONY: help install build up start down stop restart rebuild \
        logs logs-api logs-admin logs-worker logs-recorder ps status health \
        db-shell db-migrate db-empty db-reset clean \
        mock-server crawl-mock test docs \
        extension extension-watch

COMPOSE := docker compose

.DEFAULT_GOAL := help

help: ## Show this help
	@echo "Usage: make <target>"
	@echo ""
	@awk 'BEGIN {FS = ":.*##"} /^[a-zA-Z_-]+:.*##/ { printf "  %-16s %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

## --- Lifecycle ---

install: build ## Build all images (Postgres/Neo4j are pulled, app images built via Docker -- no local Node needed)

build: ## Build the crawler-app / crawl-worker images
	$(COMPOSE) build

up: ## Start the full stack (Postgres, Neo4j, API, admin, worker) in the background
	$(COMPOSE) up -d
	@echo ""
	@echo "API:        http://localhost:3000"
	@echo "Swagger UI: http://localhost:3000/api-docs"
	@echo "Admin:      http://localhost:3001/admin"
	@echo "Neo4j:      http://localhost:7474"

start: up ## Alias for 'up'

down: ## Stop all services (keeps Postgres/Neo4j data volumes)
	$(COMPOSE) down

stop: down ## Alias for 'down'

restart: down up ## Stop then start the full stack

rebuild: ## Rebuild images and restart (use after pulling/making code changes)
	$(COMPOSE) up -d --build

## --- Observability ---

logs: ## Tail logs for all services
	$(COMPOSE) logs -f

logs-api: ## Tail API server logs
	$(COMPOSE) logs -f crawler-app

logs-admin: ## Tail admin backoffice server logs
	$(COMPOSE) logs -f admin

logs-worker: ## Tail crawl-worker logs
	$(COMPOSE) logs -f crawl-worker

logs-recorder: ## Tail workflow-agent-worker (Playwright recording agent) logs
	$(COMPOSE) logs -f workflow-agent-worker

ps: ## Show status of this project's containers
	$(COMPOSE) ps

status: ps ## Alias for 'ps'

health: ## Curl the API health check
	curl -sf http://localhost:3000/health && echo || (echo "API is not responding -- is it running? (make up)" && exit 1)

docs: ## Open the Swagger UI docs in a browser
	@open http://localhost:3000/api-docs 2>/dev/null || echo "Open http://localhost:3000/api-docs in your browser"

## --- Database ---

db-shell: ## Open a psql shell into the Postgres container
	docker exec -it crawler_postgres psql -U crawler_user -d crawler_db

db-migrate: ## Create/verify schema from init.sql (idempotent -- safe to re-run against an existing DB)
	docker exec -i crawler_postgres psql -U crawler_user -d crawler_db < init.sql
	@echo "Schema created/verified from init.sql."

db-empty: ## Delete all rows from every table, but keep the schema (asks for confirmation)
	@read -p "This deletes ALL data from every table but keeps the schema. Continue? [y/N] " ans; \
	if [ "$$ans" = "y" ] || [ "$$ans" = "Y" ]; then \
		docker exec -i crawler_postgres psql -U crawler_user -d crawler_db -c \
			"TRUNCATE crawl_jobs, crawl_credentials, pages, page_snapshots, ui_elements, entities, actions, relationships, workflows, workflow_steps, workflow_runs, knowledge_summaries CASCADE;"; \
		echo "Postgres data cleared."; \
	else \
		echo "Aborted."; \
	fi

db-reset: ## Stop everything and permanently delete the Postgres/Neo4j volumes (asks for confirmation)
	@read -p "This stops all services and PERMANENTLY deletes the Postgres+Neo4j volumes. Continue? [y/N] " ans; \
	if [ "$$ans" = "y" ] || [ "$$ans" = "Y" ]; then \
		$(COMPOSE) down -v; \
		echo "Volumes wiped. Run 'make up' to start fresh."; \
	else \
		echo "Aborted."; \
	fi

clean: db-reset ## Alias for 'db-reset'

## --- Chrome extension ---

# The extension-builder image COPYs the extension source in at image-build time, so the
# image has to be rebuilt for the bundle to pick up source changes -- hence build + run,
# not run alone. It writes into ./extension/dist through the bind mount, then exits.
extension: ## Build the Chrome extension bundle into extension/dist (no local Node needed)
	$(COMPOSE) build extension-builder
	$(COMPOSE) run --rm extension-builder
	@echo ""
	@echo "Extension bundled into ./extension/dist"
	@echo "Load it in Chrome: chrome://extensions -> Developer mode -> Load unpacked -> $(CURDIR)/extension/dist"

extension-watch: ## Rebuild the extension on every source change (Ctrl-C to stop)
	$(COMPOSE) build extension-builder
	$(COMPOSE) run --rm \
		-v "$(CURDIR)/extension/src:/app/src" \
		-v "$(CURDIR)/extension/public:/app/public" \
		extension-builder node build.js --watch

## --- Demo ---

mock-server: ## Launch the built-in mock CRM app inside crawler_app (container-internal, port 4000)
	docker exec -d crawler_app node dist/mock-crm-server.js
	@echo "Mock CRM running inside crawler_app on port 4000 (reachable at http://crawler_app:4000 from other containers)."

crawl-mock: mock-server ## Launch the mock CRM and queue a crawl of it via the API
	sleep 1
	curl -s -X POST http://localhost:3000/api/crawl \
		-H "Content-Type: application/json" \
		-d '{"targetUrl":"http://crawler_app:4000/dashboard"}'
	@echo ""

test: ## Run the self-contained mock crawl demo (no job queue -- prints a summary, writes output_schema.json)
	docker exec crawler_app npm run test:mock
