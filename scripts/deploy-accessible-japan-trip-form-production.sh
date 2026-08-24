#!/bin/zsh
set -euo pipefail

SCRIPT_PATH="${(%):-%N}"
SCRIPT_DIR="${SCRIPT_PATH:A:h}"
ROOT_DIR="${SCRIPT_DIR:h}"
FORM_ID="9ab583b2-e42e-4ca2-bcb9-13a3c59f5477"
PUBLIC_URL="https://liffform-studio.pages.dev/public-form?id=${FORM_ID}"
MANAGEMENT_URL="https://liffform-studio.pages.dev/?formId=${FORM_ID}"

source "$ROOT_DIR/scripts/cloudflare-env.sh"
cloudflare_require_token

echo "=== Deploying the repeatable city/date form UI ==="
ALLOW_NON_MAIN_DEPLOY=1 zsh "$ROOT_DIR/scripts/deploy-forms-studio-production.sh"

echo "=== Registering the Accessible Japan form in remote D1 ==="
form_sql="$(node "$ROOT_DIR/scripts/register-accessible-japan-trip-form.mjs" --sql)"
cloudflare_wrangler d1 execute line-crm \
  --remote \
  --config "$ROOT_DIR/apps/worker/wrangler.toml" \
  --command "$form_sql"
unset form_sql

echo "=== Reading back the exact production form ==="
cloudflare_wrangler d1 execute line-crm \
  --remote \
  --config "$ROOT_DIR/apps/worker/wrangler.toml" \
  --command "SELECT id, name, locale, json_array_length(fields) AS field_count, save_to_metadata, is_active, submit_count, updated_at FROM forms WHERE id = '${FORM_ID}';"

echo "Public URL: ${PUBLIC_URL}"
echo "Management URL: ${MANAGEMENT_URL}"
