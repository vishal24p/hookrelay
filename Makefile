COMPOSE := docker compose
COMPOSE_BASE := -f docker-compose.yml
COMPOSE_DEV := -f docker-compose.yml -f docker-compose.dev.yml
FRONTEND_NPM := npm --prefix frontend

.PHONY: help check test test-one lint build dev up down logs clean health backend-test frontend-install frontend-test frontend-lint frontend-build license-check compose-check

help:
	@echo "Targets:"
	@echo "  make test       Run backend and frontend tests"
	@echo "  make test-one TEST=<module-or-file>  Run one backend unittest module or frontend Vitest file"
	@echo "  make lint       Run frontend lint"
	@echo "  make build      Run frontend build"
	@echo "  make check      Run tests, lint, build, license, and compose config checks"
	@echo "  make dev        Start the dev compose stack in the foreground"
	@echo "  make up         Start the base compose stack in the background"
	@echo "  make down       Stop compose services"
	@echo "  make logs       Follow compose logs"
	@echo "  make health     Show compose service status"
	@echo "  make clean      Stop compose services and remove generated local artifacts"

check: test lint build license-check compose-check

test: backend-test frontend-test

test-one:
	@if [ -z "$(TEST)" ]; then echo "Usage: make test-one TEST=backend.tests.test_api_smoke"; echo "       make test-one TEST=frontend/src/App.test.jsx"; exit 2; fi
	@if echo "$(TEST)" | grep -qE '(^frontend/|\.(js|jsx|ts|tsx)$$)'; then $(FRONTEND_NPM) run test -- "$(TEST)"; else python -m unittest "$(TEST)"; fi

lint: frontend-lint

build: frontend-build

dev:
	$(COMPOSE) $(COMPOSE_DEV) up --build

up:
	$(COMPOSE) $(COMPOSE_BASE) up --build -d

down:
	$(COMPOSE) $(COMPOSE_DEV) down

logs:
	$(COMPOSE) $(COMPOSE_DEV) logs -f

health:
	curl -fsS http://localhost:$${HOOKRELAY_HTTP_PORT:-8080}/api/health

clean:
	$(COMPOSE) $(COMPOSE_DEV) down --remove-orphans
	rm -rf frontend/dist frontend/coverage backend/.pytest_cache backend/__pycache__ backend/app/__pycache__ backend/tests/__pycache__ .pytest_cache .coverage htmlcov

backend-test:
	python -m unittest discover -s backend/tests -p "test_*.py"

frontend-install:
	$(FRONTEND_NPM) ci

frontend-test: frontend-install
	$(FRONTEND_NPM) run test

frontend-lint: frontend-install
	$(FRONTEND_NPM) run lint

frontend-build: frontend-install
	$(FRONTEND_NPM) run build

license-check:
	python -c "from pathlib import Path; lines = Path('LICENSE').read_text(encoding='utf-8').splitlines(); ok = bool(lines) and lines[0] == 'MIT License' and not any(line.startswith(('<<<<<<<', '=======', '>>>>>>>')) for line in lines); raise SystemExit(0 if ok else 1)"

compose-check:
	docker compose -f docker-compose.yml config --quiet
	docker compose -f docker-compose.yml -f docker-compose.dev.yml config --quiet
