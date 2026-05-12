---
"@openape/nest": minor
---

Adds a persistent WebSocket connection to the troop server. While
the existing 5-minute sync-poll keeps running as a fallback, the
new control-plane lets the troop server push two kinds of frames:

- `config-update` — fired whenever the owner edits an agent's
  prompt / tools / SOUL / skills in the troop UI. The nest
  immediately runs `apes run --as <name> -- apes agents sync`, so
  the agent's local config reflects the edit within ~1s instead of
  up to 5min.
- `spawn-intent` — fired when the owner clicks "+ Spawn agent"
  in troop. The nest invokes `apes agents spawn` locally; the
  DDISA grant prompt fires in front of the human at the Mac so
  HITL stays intact.

Connection auth uses the existing IdP access token (DDISA bearer);
the troop server verifies it via JWKS and requires `act: human`.
Reconnect is exponential-backoff 1s → 30s with a 30s heartbeat,
and the nest reports its `host_id` (macOS IOPlatformUUID) +
`hostname` so the troop UI can show a `● live` badge on the
agent-detail page.

Dependencies: `ws` ^8.18 (new). TypeScript target bumped ES2022 →
ES2023 for `Array.prototype.toSorted`.
