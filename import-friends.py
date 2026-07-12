#!/usr/bin/env python3
"""Import LINE friends and chat history into CRM D1 database."""

import json
import subprocess
import uuid
import urllib.request
import time
import sys

# Config
ACCOUNTS = [
    {
        "name": "自在旅遊",
        "account_id": "41f80e27-1b4c-46fc-a74b-5c74e5bd57f4",
        "channel_id": "2009436527",
        "token": "UUm9RRQAs0ZvC1a71JaT2p6HNLsgJcQTDMB2Wk92Td919WAt7JxmOsmtJxzrVc3TTQzE6TwF4R90r8hGdbYYO1TJHzGBr/mbePo2ri5NkvYBTFX5Cezhh7ShepBG8czO0vuBRK+dcwD81AC5FrwgnQdB04t89/1O/w1cDnyilFU=",
    },
    {
        "name": "フラットトラベル",
        "account_id": "b332fd07-c525-4a7c-a48c-210a6515797b",
        "channel_id": "2009150398",
        "token": "6QyPMgFkz/Cs1Xjyaf88YC83W5EDdmWNWs5q/x/RFv7eo5v8hWq+susZOHzpQ6/qQk427MUrOCIg5TASysSPrk1OcJp8AhCAD9kTzOTNFXiEi4kFA1K9PWm6hGeuTq6hudO3HAy2JA3FE1h6ezd1aQdB04t89/1O/w1cDnyilFU=",
    },
]

DB_NAME = "line-crm"
WORKER_DIR = "/Users/maedahibiki/Flatcare/line-harness-oss/apps/worker"


def line_api_get(url: str, token: str):
    """Call LINE API."""
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


def get_followers(token: str) -> list[str]:
    """Get all follower IDs (handles pagination)."""
    all_ids = []
    url = "https://api.line.me/v2/bot/followers/ids"
    while url:
        data = line_api_get(url, token)
        all_ids.extend(data.get("userIds", []))
        next_token = data.get("next")
        if next_token:
            url = f"https://api.line.me/v2/bot/followers/ids?start={next_token}"
        else:
            url = None
    return all_ids


def get_profile(user_id: str, token: str) -> dict:
    """Get user profile."""
    try:
        return line_api_get(f"https://api.line.me/v2/bot/profile/{user_id}", token)
    except Exception as e:
        print(f"  ⚠ Profile fetch failed for {user_id}: {e}")
        return {"userId": user_id, "displayName": "Unknown"}


def escape_sql(s: str) -> str:
    """Escape single quotes for SQL."""
    if s is None:
        return "NULL"
    return "'" + s.replace("'", "''") + "'"


def execute_d1(sql: str):
    """Execute SQL on remote D1."""
    result = subprocess.run(
        ["npx", "wrangler", "d1", "execute", DB_NAME, "--remote", "--command", sql],
        capture_output=True,
        text=True,
        cwd=WORKER_DIR,
    )
    if result.returncode != 0:
        print(f"  ⚠ D1 error: {result.stderr[:200]}")
    return result


def import_account(account: dict):
    """Import all friends for one LINE account."""
    name = account["name"]
    account_id = account["account_id"]
    token = account["token"]

    print(f"\n{'='*60}")
    print(f"📱 {name} のフレンドをインポート中...")
    print(f"{'='*60}")

    # Get followers
    followers = get_followers(token)
    total = len(followers)
    print(f"  友だち数: {total}人")

    # Get profiles and batch insert
    batch_sql = []
    for i, user_id in enumerate(followers):
        profile = get_profile(user_id, token)
        time.sleep(0.1)  # Rate limit

        friend_id = str(uuid.uuid4())
        display_name = profile.get("displayName", "Unknown")
        picture_url = profile.get("pictureUrl")
        status_message = profile.get("statusMessage")

        sql = (
            f"INSERT OR IGNORE INTO friends (id, line_user_id, display_name, picture_url, status_message, is_following, score, line_account_id, created_at, updated_at) "
            f"VALUES ({escape_sql(friend_id)}, {escape_sql(user_id)}, {escape_sql(display_name)}, {escape_sql(picture_url)}, {escape_sql(status_message)}, 1, 0, {escape_sql(account_id)}, "
            f"strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'), strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))"
        )
        batch_sql.append(sql)
        print(f"  [{i+1}/{total}] {display_name}")

        # Execute in batches of 10
        if len(batch_sql) >= 10:
            combined = "; ".join(batch_sql)
            execute_d1(combined)
            batch_sql = []

    # Execute remaining
    if batch_sql:
        combined = "; ".join(batch_sql)
        execute_d1(combined)

    print(f"  ✅ {total}人のフレンドをインポートしました")


def get_chat_history(user_id: str, token: str) -> list[dict]:
    """Get chat history using LINE Messaging API.

    NOTE: LINE Messaging API does NOT provide a way to retrieve past messages.
    Messages can only be received via webhook in real-time.
    The /v2/bot/message/{messageId}/content endpoint only retrieves media content
    for messages received within the last 14 days.
    """
    return []


def main():
    # Check for unique constraint on line_user_id
    print("🔧 line_user_id にユニークインデックスを追加中...")
    execute_d1("CREATE UNIQUE INDEX IF NOT EXISTS idx_friends_line_user_id ON friends(line_user_id, line_account_id)")

    for account in ACCOUNTS:
        import_account(account)

    # Verify
    print(f"\n{'='*60}")
    print("📊 インポート結果の確認")
    print(f"{'='*60}")
    result = subprocess.run(
        ["npx", "wrangler", "d1", "execute", DB_NAME, "--remote",
         "--command", "SELECT line_account_id, COUNT(*) as count FROM friends GROUP BY line_account_id"],
        capture_output=True, text=True, cwd=WORKER_DIR,
    )
    print(result.stdout[-500:] if result.stdout else result.stderr[:500])


if __name__ == "__main__":
    main()
