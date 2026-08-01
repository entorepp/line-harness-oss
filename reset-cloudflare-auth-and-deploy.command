#!/bin/zsh
set -euo pipefail

ROOT_DIR="/Users/maedahibiki/Flatcare/line-harness-quote-intent-deploy"

printf "Cloudflare Account ID: " >&2
IFS= read -r account_id

if [[ ! "$account_id" =~ '^[0-9a-fA-F]{32}$' ]]; then
  echo "Account ID must be the 32-character Cloudflare account identifier." >&2
  exit 1
fi

export CLOUDFLARE_ACCOUNT_ID="$account_id"
unset account_id

cd "$ROOT_DIR"
zsh scripts/cloudflare-save-token.sh
zsh scripts/cloudflare-check.sh
exec "$ROOT_DIR/deploy-travel-quote-intent.command"
