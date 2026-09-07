# Flat Harness production boundary

- The integrated Worker source is `production/flat-harness-worker`. `main` is the separately maintained web baseline and must never deploy the Worker.
- Read `/Users/maedahibiki/system-registry/docs/flat-harness-wa-send-incident-2026-09-07.md` before a production Worker change.
- All Worker production releases use `zsh scripts/deploy-worker-production.sh`. Direct `wrangler deploy`, old worktree deploy scripts, and bypassing the release checks are forbidden.
- The release must include the current production source commit, pass the WhatsApp and existing intake/email contracts, preserve existing HTTP routes and router mounts, and verify the exact emitted bytes in Cloudflare after deployment.
- A version change while testing requires rebase and a new preflight. Do not retry the deploy automatically or overwrite the newer release.
- Do not resend failed or historical customer messages while fixing product code. Sending, acceptance and recipient delivery remain separate claims.
