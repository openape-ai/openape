---
"@openape/apes": minor
"@openape/proxy": patch
---

apes: new `apes proxy -- <cmd>` subcommand routes commands through the egress proxy

```bash
apes proxy -- curl https://api.github.com/zen
apes proxy -- gh repo list
apes proxy -- bash -c 'curl https://...'
```

The subcommand mirrors the orchestration shape of `apes run --root → escapes`:
it is a thin wrapper that owns the *lifecycle*, not the policy. The actual
allow/deny/grant-required rules live in `@openape/proxy` (a separate runnable),
which is now spawned as a child process per invocation.

Two lifecycle modes:

1. **Ephemeral (default):** `apes proxy --` spawns a new `openape-proxy` child
   bound to a random free port on `127.0.0.1`, runs the wrapped command with
   `HTTPS_PROXY` / `HTTP_PROXY` pointing at it, kills the proxy on wrapped-
   command exit. Lifecycle = command lifecycle, like `time` or `op run`.
2. **Reuse:** if `OPENAPE_PROXY_URL` is set in the environment, `apes proxy --`
   skips the spawn and points `HTTPS_PROXY` at the existing URL. This is the
   path that ape-shell will take in M1b: the user can run `openape-proxy &`
   themselves, `export OPENAPE_PROXY_URL=...`, and every subsequent
   `apes proxy --` reuses that long-lived daemon.

Default config for the ephemeral spawn is permissive (`default_action = "allow"`)
plus a small deny-list for cloud-metadata endpoints (AWS/GCP/Azure
`169.254.169.254`, `metadata.google.internal`, `*.internal`). Per-user TOML
overlay + harder defaults land in M2.

`@openape/proxy` patch: the listen-callback now reads `server.address()` so
the `Listening on http://...:<port>` line shows the actual bound port even
when configured with `listen = "127.0.0.1:0"`. Used by `apes proxy --` to
discover its child's port.
