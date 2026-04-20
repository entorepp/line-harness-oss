#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PRODUCTION_BRANCH="main"
PRODUCTION_PROJECT="line-crm-web"
PRODUCTION_URL="https://line-crm-web-2ob.pages.dev"
CURRENT_BRANCH="${GITHUB_REF_NAME:-}"

if [[ -z "$CURRENT_BRANCH" ]]; then
  CURRENT_BRANCH="$(git -C "$ROOT_DIR" symbolic-ref --quiet --short HEAD 2>/dev/null || true)"
fi

if [[ "${ALLOW_NON_MAIN_DEPLOY:-0}" != "1" && "$CURRENT_BRANCH" != "$PRODUCTION_BRANCH" ]]; then
  echo "Refusing to deploy web from branch '$CURRENT_BRANCH'."
  echo "Switch to '$PRODUCTION_BRANCH' or set ALLOW_NON_MAIN_DEPLOY=1 to override."
  exit 1
fi

echo "=== Building web app ==="
cd "$ROOT_DIR"
pnpm --filter web build

if [[ ! -d "$ROOT_DIR/apps/web/out" ]]; then
  echo "Build output not found: $ROOT_DIR/apps/web/out"
  exit 1
fi

echo "=== Deploying web to ${PRODUCTION_URL} ==="
cd "$ROOT_DIR/apps/worker"
pnpm exec wrangler pages deploy ../web/out \
  --project-name="${PRODUCTION_PROJECT}" \
  --branch="${PRODUCTION_BRANCH}"
