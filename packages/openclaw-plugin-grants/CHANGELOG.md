# @openape/openclaw-plugin-grants

## 0.2.0

### Minor Changes

- [`4f74ec4`](https://github.com/openape-ai/openape/commit/4f74ec43ca0b0a2b2edbb7644a281db965eb4bea) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Add @openape/openclaw-plugin-grants — OpenClaw plugin for grant-based command execution

  - Adapter system with TOML-based CLI definitions (gh, az, exo bundled)
  - Command → granular permission resolution (resource chains, coverage matching)
  - Local mode: channel approval, local Ed25519 JWT signing, JWKS endpoint
  - IdP mode: DNS discovery, Ed25519 challenge-response auth, federated grants (RFC 9396)
  - Grant store with file persistence, permission-based cache, JSONL audit log
  - apes integration for privileged execution
  - CLI: openclaw grants status/list/revoke/adapters

### Patch Changes

- Updated dependencies [[`bd1eb0d`](https://github.com/openape-ai/openape/commit/bd1eb0d83f700f1c289d21a545d3d62ced7f44d6)]:
  - @openape/core@0.8.0
  - @openape/grants@0.5.2
