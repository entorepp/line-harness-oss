#!/bin/zsh
set -euo pipefail

SCRIPT_PATH="${(%):-%N}"
SCRIPT_DIR="${SCRIPT_PATH:A:h}"
ROOT_DIR="${SCRIPT_DIR:h}"
KEYCHAIN_TOKEN_SERVICE="${CLOUDFLARE_KEYCHAIN_SERVICE:-codex-cloudflare-api-token}"
KEYCHAIN_ACCOUNT_SERVICE="${CLOUDFLARE_ACCOUNT_KEYCHAIN_SERVICE:-codex-cloudflare-account-id}"

if ! command -v security >/dev/null 2>&1; then
  echo "macOS Keychain command 'security' was not found." >&2
  exit 1
fi

if [[ -n "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  token="$CLOUDFLARE_API_TOKEN"
elif [[ -t 0 ]]; then
  printf "Cloudflare API token: " >&2
  stty -echo
  IFS= read -r token
  stty echo
  printf "\n" >&2
else
  cat >&2 <<EOF
Cloudflare API token is required.

Run this script in an interactive terminal, or pass the token via:
  CLOUDFLARE_API_TOKEN=... zsh scripts/cloudflare-save-token.sh
EOF
  exit 1
fi

if [[ -z "$token" ]]; then
  echo "Token was empty; nothing saved." >&2
  exit 1
fi

account_id="${CLOUDFLARE_ACCOUNT_ID:-}"
if [[ -z "$account_id" && -f "$HOME/.wrangler/cache/wrangler-account.json" ]]; then
  account_id="$(node -e "try { const data = require(process.env.HOME + '/.wrangler/cache/wrangler-account.json'); process.stdout.write(data?.account?.id || '') } catch {}" 2>/dev/null || true)"
fi

if [[ "$token" == cfat_* ]]; then
  if [[ -z "$account_id" ]]; then
    echo "Account API token detected, but Cloudflare account id was not found." >&2
    echo "Set CLOUDFLARE_ACCOUNT_ID and retry." >&2
    exit 1
  fi
  verify_url="https://api.cloudflare.com/client/v4/accounts/${account_id}/tokens/verify"
else
  verify_url="https://api.cloudflare.com/client/v4/user/tokens/verify"
fi

verify_response="$(curl -4 -fsS \
  -H "Authorization: Bearer $token" \
  "$verify_url")"

verified="$(node -e "const data=JSON.parse(process.argv[1]); process.stdout.write(data.success ? 'yes' : 'no')" "$verify_response")"
if [[ "$verified" != "yes" ]]; then
  echo "Cloudflare token verification failed." >&2
  exit 1
fi

security add-generic-password \
  -U \
  -a "${USER:-codex}" \
  -s "$KEYCHAIN_TOKEN_SERVICE" \
  -w "$token" >/dev/null

account_response=""
if [[ "$token" != cfat_* ]]; then
  account_response="$(curl -4 -fsS \
    -H "Authorization: Bearer $token" \
    "https://api.cloudflare.com/client/v4/accounts" || true)"
fi

if [[ -n "$account_response" ]]; then
  account_count="$(node -e "const data=JSON.parse(process.argv[1]); process.stdout.write(String(Array.isArray(data.result) ? data.result.length : 0))" "$account_response")"
  if [[ "$account_count" == "1" ]]; then
    account_id="$(node -e "const data=JSON.parse(process.argv[1]); process.stdout.write(data.result[0]?.id || '')" "$account_response")"
  elif [[ "$account_count" != "0" ]]; then
    echo "Multiple Cloudflare accounts are available:" >&2
    node -e "const data=JSON.parse(process.argv[1]); for (const account of data.result || []) console.error(`${account.name}: ${account.id}`)" "$account_response"
    printf "Cloudflare account id to save (blank to skip): " >&2
    IFS= read -r account_id
  fi
fi

unset token verify_response account_response account_count

if [[ -n "$account_id" ]]; then
  security add-generic-password \
    -U \
    -a "${USER:-codex}" \
    -s "$KEYCHAIN_ACCOUNT_SERVICE" \
    -w "$account_id" >/dev/null
  echo "Cloudflare account id saved to macOS Keychain."
fi

unset account_id

echo "Cloudflare API token saved to macOS Keychain for Codex deploys."
echo "Run: zsh scripts/cloudflare-check.sh"
