---
"@openape/nest": minor
---

nest now relays capability secrets: it handles `secret-update` /
`secret-revoke` frames from troop by writing/removing an opaque sealed
blob in the agent's `~/.config/openape/secrets.d/<env>.blob` as the agent
user (blob piped via stdin, never argv). nest never opens the blob — it
is a blind relay; only the agent can decrypt it.
