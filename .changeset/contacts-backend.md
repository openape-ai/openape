---
"@openape/apes": minor
"@openape/chat-bridge": patch
---

Phase A backend — chat-app gains a `contacts` table + friend-request lifecycle. `apes agents spawn --bridge` now POSTs `/api/contacts` instead of creating a DM room directly; the bridge daemon accepts pending requests on first connect, completing the bilateral handshake without manual intervention. Direct `POST /api/rooms { kind: 'dm' }` is now rejected — DMs are owned by the contacts model and lazy-created on bilateral accept.
