---
"@openape/apes": minor
---

`apes agents spawn` now also generates an X25519 encryption keypair for the
agent (separate from the ed25519 auth key). The private key is written to
`~/.config/openape/agent-x25519.key` (0600) and the public key alongside
(`.pub`, 0644), so troop can seal capability secrets to the agent's public
key and only the agent can open them.
