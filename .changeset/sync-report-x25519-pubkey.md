---
"@openape/apes": patch
---

fix(agents sync): report the agent's X25519 public key to troop

The capability broker seals secrets to an agent's X25519 public key, but
`apes agents sync` only ever sent `pubkey_ssh` — so `pubkey_x25519` stayed
null for every agent and every sealed-secret bind failed with HTTP 409
("agent has no X25519 public key yet"). Sync now reads
`~/.config/openape/agent-x25519.key.pub` (written at spawn) and includes
it in the sync payload, which troop already accepts. Sealed capability
secrets (e.g. a coding agent's GH_TOKEN) can finally be bound.
