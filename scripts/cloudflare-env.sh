#!/bin/zsh

# Shared Cloudflare runtime setup for non-interactive Codex deploys.
# Secrets are read from the environment first, then from macOS Keychain.

set -euo pipefail

SCRIPT_PATH="${(%):-%N}"
SCRIPT_DIR="${SCRIPT_PATH:A:h}"
ROOT_DIR="${SCRIPT_DIR:h}"
KEYCHAIN_TOKEN_SERVICE="${CLOUDFLARE_KEYCHAIN_SERVICE:-codex-cloudflare-api-token}"
KEYCHAIN_ACCOUNT_SERVICE="${CLOUDFLARE_ACCOUNT_KEYCHAIN_SERVICE:-codex-cloudflare-account-id}"

case " ${NODE_OPTIONS:-} " in
  *" --dns-result-order="*) ;;
  *) export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--dns-result-order=ipv4first" ;;
esac

read_keychain_secret() {
  local service="$1"
  if ! command -v security >/dev/null 2>&1; then
    return 1
  fi
  security find-generic-password -a "${USER:-codex}" -s "$service" -w 2>/dev/null || true
}

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  token="$(read_keychain_secret "$KEYCHAIN_TOKEN_SERVICE")"
  if [[ -n "$token" ]]; then
    export CLOUDFLARE_API_TOKEN="$token"
  fi
  unset token
fi
if [[ -n "${CLOUDFLARE_API_TOKEN:-}" && -z "${CF_API_TOKEN:-}" ]]; then
  export CF_API_TOKEN="$CLOUDFLARE_API_TOKEN"
fi

if [[ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]]; then
  account_id="$(read_keychain_secret "$KEYCHAIN_ACCOUNT_SERVICE")"
  if [[ -z "$account_id" && -f "$HOME/.wrangler/cache/wrangler-account.json" ]]; then
    account_id="$(node -e "try { const data = require(process.env.HOME + '/.wrangler/cache/wrangler-account.json'); process.stdout.write(data?.account?.id || '') } catch {}" 2>/dev/null || true)"
  fi
  if [[ -n "$account_id" ]]; then
    export CLOUDFLARE_ACCOUNT_ID="$account_id"
  fi
  unset account_id
fi
if [[ -n "${CLOUDFLARE_ACCOUNT_ID:-}" && -z "${CF_ACCOUNT_ID:-}" ]]; then
  export CF_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID"
fi

cloudflare_require_token() {
  if [[ -n "${CLOUDFLARE_API_TOKEN:-}" ]]; then
    return 0
  fi

  cat >&2 <<EOF
Cloudflare API token is not available.

Run this once from the repo root:
  zsh scripts/cloudflare-save-token.sh

Token permissions needed:
  - Account: Cloudflare Pages: Edit
  - Account: Workers Scripts: Edit
  - Account: D1: Edit
  - Account: Account Settings: Read
  - Account: Workers KV Storage: Edit
EOF
  return 1
}

cloudflare_wrangler() {
  cloudflare_require_token
  "$ROOT_DIR/apps/worker/node_modules/.bin/wrangler" "$@"
}
