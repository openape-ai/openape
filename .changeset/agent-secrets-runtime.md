---
"@openape/apes": minor
---

The agent runtime now materializes capability secrets: it opens the
sealed blobs in `~/.config/openape/secrets.d/` with its X25519 private
key and injects them into `process.env` so the agent's tools see them.
`apes agents run` does this once per task; `apes agents serve` watches
the dir so troop rotate/revoke takes effect live without a re-deploy.
The agent is the only place the plaintext ever exists.
