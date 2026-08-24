#!/bin/zsh
set -euo pipefail

SCRIPT_PATH="${(%):-%N}"
SCRIPT_DIR="${SCRIPT_PATH:A:h}"
ROOT_DIR="${SCRIPT_DIR:h}"
FORM_ID="9ab583b2-e42e-4ca2-bcb9-13a3c59f5477"
PUBLIC_URL="https://liffform-studio.pages.dev/public-form?id=${FORM_ID}"
MANAGEMENT_URL="https://liffform-studio.pages.dev/?formId=${FORM_ID}"

source "$ROOT_DIR/scripts/cloudflare-env.sh"

run_wrangler() {
  if [[ -n "${CLOUDFLARE_API_TOKEN:-}" ]]; then
    cloudflare_wrangler "$@"
    return
  fi

  "$ROOT_DIR/apps/worker/node_modules/.bin/wrangler" "$@"
}

echo "=== Deploying the repeatable city/date form UI ==="
cd "$ROOT_DIR"
pnpm --filter @line-crm/shared build
NEXT_PUBLIC_API_URL="" pnpm --filter forms-studio build
run_wrangler pages deploy apps/forms-studio/out \
  --project-name=liffform-studio \
  --branch=main

echo "=== Registering the Accessible Japan form in remote D1 ==="
form_sql="$(node "$ROOT_DIR/scripts/register-accessible-japan-trip-form.mjs" --sql)"
run_wrangler d1 execute line-crm \
  --remote \
  --config "$ROOT_DIR/apps/worker/wrangler.toml" \
  --command "$form_sql"
unset form_sql

echo "=== Reading back the exact production form ==="
run_wrangler d1 execute line-crm \
  --remote \
  --config "$ROOT_DIR/apps/worker/wrangler.toml" \
  --command "SELECT id, name, locale, json_array_length(fields) AS field_count, save_to_metadata, is_active, submit_count, updated_at FROM forms WHERE id = '${FORM_ID}';"

echo "Public URL: ${PUBLIC_URL}"
echo "Management URL: ${MANAGEMENT_URL}"
