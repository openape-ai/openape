---
"@openape/ape-agent": minor
---

Backfill chat history from the server when a ThreadSession is first
created. Without this, a bridge restart left the agent with empty
`history` — it would respond to the next message without knowing
anything that happened earlier in the same thread, even though the
chat server has the full transcript. Now the first turn after
construction fetches the last 50 messages via
`GET /api/rooms/:id/messages?thread_id=…` and seeds them into
history. Failures are non-fatal: the bridge logs and continues with
empty history (matching the pre-backfill behaviour).
