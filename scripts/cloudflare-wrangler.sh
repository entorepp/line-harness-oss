#!/bin/zsh
set -euo pipefail

SCRIPT_PATH="${(%):-%N}"
SCRIPT_DIR="${SCRIPT_PATH:A:h}"
ROOT_DIR="${SCRIPT_DIR:h}"
source "$ROOT_DIR/scripts/cloudflare-env.sh"

cloudflare_wrangler "$@"
