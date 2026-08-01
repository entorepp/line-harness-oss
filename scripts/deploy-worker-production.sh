#!/bin/zsh
set -euo pipefail

SCRIPT_PATH="${(%):-%N}"
SCRIPT_DIR="${SCRIPT_PATH:A:h}"
ROOT_DIR="${SCRIPT_DIR:h}"
source "$ROOT_DIR/scripts/cloudflare-env.sh"

cloudflare_require_token

"$ROOT_DIR/scripts/verify-worker-lead-routes.sh"

echo "=== Deploying worker ==="
cd "$ROOT_DIR/apps/worker"
cloudflare_wrangler deploy
