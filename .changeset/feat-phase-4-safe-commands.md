---
'@openape/grants': minor
'@openape/nuxt-auth-idp': minor
'@openape/idp-test-suite': minor
---

Phase 4: Safe-Commands seeding + UX.

- Agent enrollment now auto-seeds 14 default safe-command standing grants for the new agent (ls, cat, head, tail, wc, file, stat, which, echo, date, whoami, pwd, find, grep). Low-risk read-only invocations of those CLIs auto-approve without a prompt.
- New UI section on `/agents/:email` to toggle defaults and add custom safe commands.
- New `/agents` page modal to bulk-apply safe commands across all of a user's agents (idempotent — already-present entries are skipped).
- New endpoint `POST /api/standing-grants/bulk-seed` for the bulk-apply flow.
- Recent-activity table on `/agents/:email` now shows a distinct "Safe cmd" badge for auto-approvals traced to a safe-command standing grant.

Existing agents are not retroactively modified; use the bulk-apply modal to opt in.
