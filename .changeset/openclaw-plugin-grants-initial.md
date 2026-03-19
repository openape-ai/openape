---
"@openape/openclaw-plugin-grants": minor
---

Add @openape/openclaw-plugin-grants — OpenClaw plugin for grant-based command execution

- Adapter system with TOML-based CLI definitions (gh, az, exo bundled)
- Command → granular permission resolution (resource chains, coverage matching)
- Local mode: channel approval, local Ed25519 JWT signing, JWKS endpoint
- IdP mode: DNS discovery, Ed25519 challenge-response auth, federated grants (RFC 9396)
- Grant store with file persistence, permission-based cache, JSONL audit log
- apes integration for privileged execution
- CLI: openclaw grants status/list/revoke/adapters
