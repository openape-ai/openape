---
'@openape/chat': minor
'@openape/ape-chat': minor
---

Remove the `kind:'channel'` rooms model and associated mutation endpoints (closes #276).

Phase A already migrated the chat UI to a 1:1-DM-only model (rooms are auto-created by the contact-accept flow), but the server still exposed enough surface to attack:

- `POST /api/rooms` (channel-creation) — any authenticated user could enrol arbitrary emails as members; the targets immediately saw the attacker-named "channel" plus Web Push notifications with arbitrary 140-char text. Perfect phishing channel routed via chat.openape.ai.
- `POST /api/rooms/:id/members` — admins could add any email and promote them to admin without a contact relationship.
- `PATCH/DELETE /api/rooms/:id/members/:email` — same blast radius for role changes / kicks.
- `POST /api/rooms/:id/{join,leave}` — channel-only flows.

All six endpoints are gone. The schema's `kind` enum is narrowed to `['dm']` only (existing 'channel' rows in production stay readable via drizzle's runtime cast — the column constraint is a TypeScript-level narrowing, not a DB migration). The CLI's `rooms create` and `members add/remove` subcommands are gone for the same reason; the read-only `members list` and the entire contacts flow are unchanged. The webapp's MemberManager component is read-only.

Surfaced in the security audit on 2026-05-04.
