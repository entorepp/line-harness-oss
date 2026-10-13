# Forms Studio password-only entry

Problem: routine management access currently asks for an operator name as well
as the existing shared credential. The owner requested a single password field.
This supports the lead-engine operations/handoff milestone without changing
Nika scope, dates, capacity or WBS.

Normal login presents one password field. It uses the existing shared API key
and server session endpoint with the non-personal actor `共有管理者` and no
personal operator key. No credential is created, rotated or embedded in assets.
Existing named sessions and legacy credential migration remain compatible.

The optional response-copy authorization control retains the existing personal
name/key flow. It starts collapsed, requires both fields only when enabled, and
clears them when toggled. Normal entry cannot acquire personal send rights.
The Worker credential comparison, session expiration, revocation, route scope,
HttpOnly cookie, CSRF protection and rate limit are unchanged.

Benefit: one input for ordinary access. Tradeoff: a shared session cannot
identify an individual; individually authorized response-copy operations still
require the named personal key. No customer message is sent by verification.

Acceptance: one default input; valid existing password permits entry; wrong
password stays on login; ordinary access is independent of personal fields;
personal authorization still works; public forms remain unchanged.

Validation: `node scripts/test-forms-studio-login.mjs` executes the actual login
component handlers and API helper with an isolated browser/network boundary.
It checks rejected/successful login, payloads, state cleanup, logout/restoration,
optional personal access and absence of credential persistence. This test is
included in the registered production deployment guard. Shared/Forms Studio
build and type checking passed. The production Worker source's existing
`pnpm --filter worker test:browser-security` suite passed unchanged.

Self-review approved: inspected the complete source diff, the shared actor is
explicitly non-personal, no send privilege or API/secret boundary expands, and
the existing backend accepts the same session request contract. The full guarded
release and live HTTP/browser readback are required before marking live.
