# Production Worker releases

`line-flattravel` is one shared Cloudflare Worker. Its production source is
`production/flat-harness-worker`; `main` remains the web source. A feature branch
must be merged into the Worker production branch before release.

Worker releases are explicit. A push does not publish the Worker. GitHub's
`Deploy Worker` manual workflow accepts only the production branch. The local
entry point is `zsh scripts/deploy-worker-production.sh`, which reads the existing
account token from the environment or macOS Keychain without printing it.

The release command refuses a dirty tree, a different branch/account, a commit
older than the WA recovery, a commit missing the recorded production source,
and a production version that changes during validation. It requires Worker/DB
typechecks, the real-SQL WhatsApp text/PDF/undo/cron/concurrency tests, and existing
quote-intake and response-email tests. It checks compiled HTTP paths and router
mounts against the current live bundle so a feature release cannot silently
remove an existing API. Deliberate route removal needs a separately reviewed
contract change.

Only the exact checked JavaScript artifact is uploaded. The command rereads its
SHA-256, source commit, D1/KV/secret bindings and public HTTP status. Evidence is
written to `apps/worker/.wrangler/production-release/`. These checks establish
the deployed code and runtime; they do not establish recipient delivery.

Use `source scripts/cloudflare-env.sh` followed by
`node scripts/deploy-worker-production.mjs --check` for the full read-only
production preflight. Do not use direct `wrangler deploy` or an old worktree's
deployment script. Do not remove tests or the source floor to force a release.
The `Worker contracts` CI check is required on the production branch.

The incident and current runtime record are maintained in
`/Users/maedahibiki/system-registry/docs/flat-harness-wa-send-incident-2026-09-07.md`.
