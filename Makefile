.PHONY: help install build up start down stop restart rebuild \
        logs logs-api logs-admin logs-worker logs-recorder ps status health \
        db-shell db-migrate db-empty db-reset clean crawls \
        mock-server crawl-mock test test-script-engine test-llm-narration docs \
        extension extension-watch cdp-browser cdp-clean

COMPOSE := docker compose

# --- CDP session-reuse (see `make cdp-browser`) ---
# Source Chrome profile to copy sessions from. Override per-call, e.g.
# `make cdp-browser CHROME_PROFILE_DIR="$$HOME/Library/Application Support/Google/Chrome/Profile 1"`
CHROME_PROFILE_DIR ?= $(HOME)/Library/Application Support/Google/Chrome/Default
CDP_PROFILE_DIR := $(CURDIR)/.chrome-cdp-profile
CDP_PORT ?= 9222

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

db-seed: ## Seed the database with demo users (Google & GitHub) and auth logs
	docker exec crawler_app npm run db:seed
	@echo "Database seeded with users and auth audit logs."

crawls: ## List every crawl with its project_id and any generated workflow_ids (for narration-preview / test-script-engine / test-llm-narration)
	@docker exec crawler_postgres psql -U crawler_user -d crawler_db -c "\
		SELECT j.target_url, j.status, j.project_id, w.id AS workflow_id, w.name AS workflow_name \
		FROM crawl_jobs j \
		LEFT JOIN workflows w ON w.project_id = j.project_id \
		ORDER BY j.created_at DESC;"

db-empty: ## Delete all rows from every table, but keep the schema (asks for confirmation)
	@read -p "This deletes ALL data from every table but keeps the schema. Continue? [y/N] " ans; \
	if [ "$$ans" = "y" ] || [ "$$ans" = "Y" ]; then \
		docker exec -i crawler_postgres psql -U crawler_user -d crawler_db -c \
			"TRUNCATE crawl_jobs, crawl_credentials, pages, page_snapshots, ui_elements, entities, actions, relationships, workflows, workflow_steps, workflow_runs, knowledge_summaries, users, user_auth_logs CASCADE;"; \
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

## --- CDP session reuse ---

# Sites like Gmail/Instagram actively block the heuristic login/signup form-fill (2FA,
# CAPTCHA, bot detection) -- see src/crawler/playwright-crawler.ts's attemptLogin/
# attemptSignup. The reliable path for those is connectCdpUrl: attach the crawl to a real,
# already-authenticated Chrome instead of trying to log in as part of the crawl. Chrome
# itself refuses --remote-debugging-port against your actual default profile directory (a
# deliberate anti session-hijacking protection), so this copies it into a throwaway
# directory first and launches a second, independent Chrome window from that copy --
# your normal browser window is untouched.
cdp-browser: ## Launch Chrome with CDP enabled, seeded from a copy of your Chrome profile (already logged into whatever you use day-to-day) -- for connectCdpUrl crawls of sites that block automated login. WARNING: copies every saved session in that profile, not just one site. Quit Chrome first for a clean copy. Optional: CHROME_PROFILE_DIR=<path>, CDP_PORT=<port>
	@echo "Source profile: $(CHROME_PROFILE_DIR)"
	@echo "WARNING: this gives the crawler CDP access to EVERY logged-in session in that profile (Gmail, banking, work SSO, everything) -- not just the one site you're crawling. Run 'make cdp-clean' when you're done."
	@echo ""
	@mkdir -p "$(CDP_PROFILE_DIR)/Default"
	@cp -R "$(CHROME_PROFILE_DIR)/." "$(CDP_PROFILE_DIR)/Default/" 2>/dev/null || true
	open -na "Google Chrome" --args \
		--remote-debugging-port=$(CDP_PORT) \
		--remote-debugging-address=0.0.0.0 \
		--remote-allow-origins=* \
		--user-data-dir="$(CDP_PROFILE_DIR)" \
		--no-first-run --no-default-browser-check
	@sleep 2
	@echo "Chrome launched with CDP on http://localhost:$(CDP_PORT)"
	@echo ""
	@# Chrome's DevTools HTTP server rejects any Host header that isn't "localhost" or a
	@# literal IP (anti DNS-rebinding hardening) -- "host.docker.internal" itself gets a 500
	@# ("Host header is specified and is not an IP address or localhost"), so the containers
	@# have to reach it by the gateway IP that hostname resolves to instead.
	@gw_ip=$$(docker exec crawler_worker getent hosts host.docker.internal 2>/dev/null | awk '{print $$1}'); \
	if [ -z "$$gw_ip" ]; then \
		echo "Could not resolve host.docker.internal from crawler_worker (is 'make up' running?). Resolve it manually and use that IP below."; \
	else \
		echo "From inside the docker containers, reach it at: http://$$gw_ip:$(CDP_PORT)"; \
		echo ""; \
		echo "1. Make sure .env has: CDP_ALLOWED_HOSTS=$$gw_ip  (then 'make up' to pick up the change if you edited it)"; \
		echo "2. POST /api/crawl with: \"connectCdpUrl\": \"http://$$gw_ip:$(CDP_PORT)\""; \
	fi

cdp-clean: ## Delete the copied Chrome profile from cdp-browser (contains real session cookies -- clean up when done)
	rm -rf "$(CDP_PROFILE_DIR)"
	@echo "Removed $(CDP_PROFILE_DIR)"

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

# Bind-mounts the repo over the crawler-app image's /usr/src/app so this always runs your
# current source (not whatever was baked in at image build time), builds it inside the
# container, and runs against the real Postgres over the docker-internal network --
# sidesteps any local Postgres already squatting on host port 5432. --service-ports is
# deliberately omitted so this doesn't try to republish :3000 alongside the already-running
# crawler_app container.
test-script-engine: ## Run DeterministicScriptEngine against real crawled workflows (optional: WORKFLOW_ID=<uuid> for just one)
	$(COMPOSE) run --rm -v "$(CURDIR):/usr/src/app" crawler-app sh -c "npm run build && node dist/test-script-engine.js $(WORKFLOW_ID)"

test-llm-narration: ## Compare deterministic vs Ollama narration for one workflow (use `make crawls` for WORKFLOW_ID). Optional: JOB_ROLE=, TARGET_AUDIENCE=, FUNCTIONALITY_FOCUS=
	@test -n "$(WORKFLOW_ID)" || (echo "WORKFLOW_ID is required, e.g. make test-llm-narration WORKFLOW_ID=<uuid> JOB_ROLE=\"Sales Manager\""; exit 1)
	$(COMPOSE) run --rm -v "$(CURDIR):/usr/src/app" crawler-app sh -c \
		"npm run build && node dist/test-llm-narration.js '$(WORKFLOW_ID)' '$(JOB_ROLE)' '$(TARGET_AUDIENCE)' '$(FUNCTIONALITY_FOCUS)'"
