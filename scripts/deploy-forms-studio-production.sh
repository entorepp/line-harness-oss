#!/bin/zsh
set -euo pipefail

SCRIPT_PATH="${(%):-%N}"
SCRIPT_DIR="${SCRIPT_PATH:A:h}"
ROOT_DIR="${SCRIPT_DIR:h}"
source "$ROOT_DIR/scripts/cloudflare-env.sh"

PRODUCTION_BRANCH="main"
PRODUCTION_PROJECT="liffform-studio"
PRODUCTION_URL="https://liffform-studio.pages.dev"
CURRENT_BRANCH="${GITHUB_REF_NAME:-}"

if [[ -z "$CURRENT_BRANCH" ]]; then
  CURRENT_BRANCH="$(git -C "$ROOT_DIR" symbolic-ref --quiet --short HEAD 2>/dev/null || true)"
fi

if [[ "${ALLOW_NON_MAIN_DEPLOY:-0}" != "1" && "$CURRENT_BRANCH" != "$PRODUCTION_BRANCH" ]]; then
  echo "Refusing to deploy forms-studio from branch '$CURRENT_BRANCH'."
  echo "Switch to '$PRODUCTION_BRANCH' or set ALLOW_NON_MAIN_DEPLOY=1 to override."
  exit 1
fi

cloudflare_require_token

echo "=== Building shared package ==="
cd "$ROOT_DIR"
pnpm --filter @line-crm/shared build

echo "=== Building forms-studio app ==="
NEXT_PUBLIC_API_URL="" pnpm --filter forms-studio build

if [[ ! -d "$ROOT_DIR/apps/forms-studio/out" ]]; then
  echo "Build output not found: $ROOT_DIR/apps/forms-studio/out"
  exit 1
fi

echo "=== Deploying forms-studio to ${PRODUCTION_URL} ==="
cd "$ROOT_DIR"
cloudflare_wrangler pages deploy apps/forms-studio/out \
  --project-name="${PRODUCTION_PROJECT}" \
  --branch="${PRODUCTION_BRANCH}"
