#!/bin/bash
# Import LINE friends into CRM

API_URL="https://line-flattravel.flat-travel.workers.dev"
API_KEY="882276e06a257b31fa4e60000a81af93714fa37592950cc5a0fb842b4c4b36de"

# Account tokens and IDs
JIZAI_TOKEN="UUm9RRQAs0ZvC1a71JaT2p6HNLsgJcQTDMB2Wk92Td919WAt7JxmOsmtJxzrVc3TTQzE6TwF4R90r8hGdbYYO1TJHzGBr/mbePo2ri5NkvYBTFX5Cezhh7ShepBG8czO0vuBRK+dcwD81AC5FrwgnQdB04t89/1O/w1cDnyilFU="
JIZAI_ACCOUNT_ID="41f80e27-1b4c-46fc-a74b-5c74e5bd57f4"

FLAT_TOKEN="6QyPMgFkz/Cs1Xjyaf88YC83W5EDdmWNWs5q/x/RFv7eo5v8hWq+susZOHzpQ6/qQk427MUrOCIg5TASysSPrk1OcJp8AhCAD9kTzOTNFXiEi4kFA1K9PWm6hGeuTq6hudO3HAy2JA3FE1h6ezd1aQdB04t89/1O/w1cDnyilFU="
FLAT_ACCOUNT_ID="b332fd07-c525-4a7c-a48c-210a6515797b"

import_friends() {
  local TOKEN="$1"
  local ACCOUNT_ID="$2"
  local ACCOUNT_NAME="$3"

  echo "=== Importing friends for $ACCOUNT_NAME ==="

  # Get follower IDs
  local FOLLOWERS=$(curl -s "https://api.line.me/v2/bot/followers/ids" \
    -H "Authorization: Bearer $TOKEN")

  local USER_IDS=$(echo "$FOLLOWERS" | python3 -c "import sys,json; ids=json.load(sys.stdin).get('userIds',[]); [print(uid) for uid in ids]")

  local COUNT=0
  local TOTAL=$(echo "$USER_IDS" | wc -l | tr -d ' ')

  for USER_ID in $USER_IDS; do
    COUNT=$((COUNT + 1))

    # Get profile
    local PROFILE=$(curl -s "https://api.line.me/v2/bot/profile/$USER_ID" \
      -H "Authorization: Bearer $TOKEN")

    local DISPLAY_NAME=$(echo "$PROFILE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('displayName','Unknown'))")
    local PICTURE_URL=$(echo "$PROFILE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('pictureUrl',''))")
    local STATUS_MSG=$(echo "$PROFILE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('statusMessage',''))")

    # Register in CRM via upsert (POST to a custom endpoint or use the webhook-style upsert)
    # We'll use D1 directly via wrangler for speed
    echo "[$COUNT/$TOTAL] $DISPLAY_NAME ($USER_ID)"
  done

  echo "=== Done: $COUNT friends ==="
}

import_friends "$JIZAI_TOKEN" "$JIZAI_ACCOUNT_ID" "自在旅遊"
import_friends "$FLAT_TOKEN" "$FLAT_ACCOUNT_ID" "フラットトラベル"
