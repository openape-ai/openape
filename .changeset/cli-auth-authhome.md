---
"@openape/cli-auth": patch
---

Add an optional `authHome` parameter to `ensureFreshIdpAuth` and the IdP-auth
storage helpers (`getConfigDir`, `getAuthFile`, `loadIdpAuth`, `saveIdpAuth`).
When omitted the behaviour is byte-identical to before; when set, it selects
which OS home's `~/.config/apes/auth.json` is read and persisted. This lets the
single-process Nest refresh each hosted agent's own token from that agent's
home without a process-wide env var.
