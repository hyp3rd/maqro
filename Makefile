# MacroCalculator - Makefile is the quality-gate contract.
#
# AGENTS.md §4: every target listed here must be wired and
# green before declaring a task done. `make ci` runs the full
# gate sequence (pre-commit + fmt-check + lint + typecheck +
# test + sec + build) and is what should pass before any merge.

NPM ?= npm
NPX ?= npx

# ---- Help ------------------------------------------------------------
help: ## Print available targets and their descriptions.
	@awk 'BEGIN {FS = ":.*##"} /^[a-zA-Z_-]+:.*##/ { printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

# ---- Development -----------------------------------------------------
dev: ## Run the dev server (next dev) on :3000.
	$(NPM) run dev

build: ## Production build (next build).
	$(NPM) run build

start: ## Run the production server (requires a prior `make build`).
	$(NPM) run start

# ---- Quality gates ---------------------------------------------------
fmt: ## Auto-format with Prettier.
	$(NPM) run format

fmt-check: ## Verify Prettier formatting (CI-friendly; non-zero on diff).
	$(NPX) prettier --ignore-unknown --check .

lint: ## Run ESLint flat config.
	$(NPM) run lint

lint-fix: ## ESLint with --fix, then re-format.
	$(NPM) run lint:fix
	$(NPM) run format

typecheck: ## TypeScript type-check (no emit).
	$(NPX) tsc --noEmit

check-budget:
	$(NPM) run check:budget

test: ## Vitest unit + component tests.
	$(NPX) vitest run

test-watch: ## Vitest in watch mode (interactive).
	$(NPX) vitest

e2e: ## Playwright end-to-end suite (auto-starts the dev server).
	$(NPX) playwright test

# `npm audit` exit codes: 1 on findings >= --audit-level threshold.
# Two transitive moderate postcss vulns ship with Next 16; the
# fix would downgrade Next to v9 (breaking). We accept moderate
# findings until Vercel patches and gate CI on `high+` only.
sec: ## Supply-chain: unscoped-supabase denylist + npm audit (high+).
	node scripts/check-banned-deps.mjs
	$(NPM) audit --audit-level=high

# Subset of hooks from .pre-commit-config.yaml: the cheap, no-Docker
# ones. `hadolint-docker` needs Docker running and `gitleaks` runs in
# its own GitHub Action, so we don't repeat them here.
pre-commit: ## Run a curated subset of pre-commit hooks (requires `pre-commit` on PATH).
	@if ! command -v pre-commit >/dev/null 2>&1; then \
		echo "pre-commit not found on PATH. Install via 'pipx install pre-commit' (or 'pip install --user pre-commit')."; \
		exit 1; \
	fi
	pre-commit run -a trailing-whitespace
	pre-commit run -a end-of-file-fixer
	pre-commit run -a markdownlint
	pre-commit run -a yamllint
	pre-commit run -a cspell

patch-version:
	$(NPM) version patch

# ---- Composite -------------------------------------------------------
# Order matters: format-check first (instant), lint next
# (fastest of the slow checks), build last (longest). Each
# step fails fast on its own - no point running `build` if
# typecheck already errored.
ci: pre-commit fmt-check lint typecheck test sec check-budget build ## Run every quality gate.

.PHONY: build ci dev e2e fmt fmt-check help lint lint-fix \
	pre-commit sec start test test-watch typecheck patch-version
