#!/bin/zsh
set -euo pipefail

SCRIPT_PATH="${(%):-%N}"
SCRIPT_DIR="${SCRIPT_PATH:A:h}"
ROOT_DIR="${SCRIPT_DIR:h}"
source "$ROOT_DIR/scripts/cloudflare-env.sh"

echo "Cloudflare DNS mode: ${NODE_OPTIONS}"

curl -4 -fsS "https://api.cloudflare.com/client/v4/ips" >/dev/null
echo "Cloudflare API network OK"

cloudflare_require_token

if [[ "${CLOUDFLARE_API_TOKEN}" == cfat_* ]]; then
  if [[ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]]; then
    echo "Account API token detected, but Cloudflare account id was not found." >&2
    exit 1
  fi
  verify_url="https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/tokens/verify"
else
  verify_url="https://api.cloudflare.com/client/v4/user/tokens/verify"
fi

curl -4 -fsS \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  "$verify_url" \
  >/tmp/cloudflare-token-verify.json

node - <<'NODE'
const fs = require('node:fs');
const data = JSON.parse(fs.readFileSync('/tmp/cloudflare-token-verify.json', 'utf8'));
if (!data.success) {
  console.error('Cloudflare token verify failed');
  process.exit(1);
}
console.log('Cloudflare token OK');
NODE

accounts_response_file="/tmp/cloudflare-accounts-check.json"
accounts_status="$(curl -4 -sS \
  -o "$accounts_response_file" \
  -w "%{http_code}" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  "https://api.cloudflare.com/client/v4/accounts")"

if [[ "$accounts_status" != "200" ]]; then
  node - "$accounts_response_file" <<'NODE'
const fs = require('node:fs');
const filePath = process.argv[2];
let message = 'Cloudflare /accounts check failed';
try {
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const firstError = data.errors?.[0];
  if (firstError?.message) {
    message = `${message}: ${firstError.message}${firstError.code ? ` [code: ${firstError.code}]` : ''}`;
  }
} catch {}
console.error(message);
if (message.includes('location') || message.includes('[code: 9109]')) {
  console.error('Remove Client IP Address Filtering from the token, or include the current public IP address.');
}
NODE
  exit 1
fi

cloudflare_wrangler whoami
