---
'@openape/apes': patch
---

Transparent session auto-refresh — no more hourly `apes login`.

- `apes login --key <path>` now persists the resolved absolute key path and agent email
  to `~/.config/apes/config.toml` so every subsequent `apes` / `ape-shell` invocation
  can auto-refresh its access token via Ed25519 challenge-response, without the user
  needing to edit the config file manually. Auto-refresh is enabled as a one-time setup,
  not a recurring ritual.
- New OAuth2 refresh_token flow in `apiFetch()` for PKCE/browser-login users: when the
  access token is expired and a `refresh_token` is stored in `auth.json`, the client
  now calls `/token` with `grant_type=refresh_token` and rotates both the access token
  and the refresh token. Concurrent refreshes are serialized via a POSIX file lock
  (`~/.config/apes/auth.json.lock`) with stale-lock eviction, so parallel `ape-shell`
  invocations don't race each other into a rotating-family revoke.
- Refresh priority: Ed25519 agent key > OAuth refresh_token > "Run `apes login` first".
  Agent-key first because each challenge is independent server-side and therefore
  concurrency-safe.
- `apes logout` now also wipes the `[agent]` section from `config.toml`, keeping
  `[defaults]` so the IdP URL survives.
- Server-side 400/401 responses to `/token` clear the stored `refresh_token` so a
  revoked family doesn't trigger an infinite retry loop.
- 13 new unit + integration tests cover the refresh priority chain, family-revoke
  handling, file-lock serialization, stale-lock eviction, config.toml merge, and
  logout wipe.
