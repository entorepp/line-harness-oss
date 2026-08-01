#!/bin/zsh
set -euo pipefail

SCRIPT_PATH="${(%):-%N}"
SCRIPT_DIR="${SCRIPT_PATH:A:h}"
ROOT_DIR="${SCRIPT_DIR:h}"
VERIFY_DIR="$(mktemp -d /private/tmp/flat-harness-lead-verify.XXXXXX)"

cleanup() {
  rm -rf "$VERIFY_DIR"
}
trap cleanup EXIT

cd "$ROOT_DIR"
pnpm --filter @line-crm/shared build
pnpm --filter @line-crm/line-sdk build
pnpm --filter @line-crm/db typecheck
pnpm --filter worker typecheck

pnpm exec esbuild apps/worker/scripts/test-travel-quote-route.ts \
  --bundle --platform=node --format=esm \
  --outfile="$VERIFY_DIR/test-travel-quote-route.mjs"
node "$VERIFY_DIR/test-travel-quote-route.mjs"

pnpm exec esbuild apps/worker/scripts/test-lead-route-topology.ts \
  --bundle --platform=node --format=esm \
  --outfile="$VERIFY_DIR/test-lead-route-topology.mjs"
node "$VERIFY_DIR/test-lead-route-topology.mjs"

cd "$ROOT_DIR/apps/worker"
pnpm exec wrangler deploy --dry-run --outdir "$VERIFY_DIR/worker"

print "WORKER_LEAD_ROUTE_VERIFY_OK"
