#!/bin/zsh
set -euo pipefail

ROOT_DIR="/Users/maedahibiki/Flatcare/line-harness-quote-intent-deploy"
LOG_FILE="/private/tmp/flat-travel-quote-intent-deploy.log"
SUCCESS_FILE="/private/tmp/flat-travel-quote-intent-deploy.success"
FAILURE_FILE="/private/tmp/flat-travel-quote-intent-deploy.failure"
DRY_RUN_DIR="$(mktemp -d /private/tmp/flat-travel-quote-dry-run.XXXXXX)"
TEST_BUNDLE="/private/tmp/flat-travel-quote-route-test.mjs"

exec > >(tee "$LOG_FILE") 2>&1
trap 'exit_code=$?; if (( exit_code == 0 )); then touch "$SUCCESS_FILE"; else print -r -- "$exit_code" > "$FAILURE_FILE"; fi' EXIT

unlink "$SUCCESS_FILE" 2>/dev/null || true
unlink "$FAILURE_FILE" 2>/dev/null || true

cd "$ROOT_DIR"
pnpm --filter @line-crm/shared build
pnpm --filter @line-crm/line-sdk build
pnpm --filter worker typecheck
pnpm --filter @line-crm/db typecheck

cd "$ROOT_DIR/apps/worker"
pnpm exec wrangler deploy --dry-run --outdir "$DRY_RUN_DIR"
../../node_modules/.pnpm/node_modules/.bin/esbuild scripts/test-travel-quote-route.ts --bundle --platform=node --format=esm --outfile="$TEST_BUNDLE"
node "$TEST_BUNDLE"

cd "$ROOT_DIR"
zsh scripts/deploy-worker-production.sh

print "TRAVEL_QUOTE_INTENT_DEPLOY_OK"
