---
"@openape/proxy": minor
---

proxy: host-based allow/deny/grant_required rules now apply at HTTPS CONNECT time

Until now `connect.ts` (the HTTPS-tunnel handler) only did SSRF protection +
optional JWT-auth before piping bytes through. The `[[allow]]` / `[[deny]]` /
`[[grant_required]]` lists in the TOML config were inert for HTTPS hosts —
they only fired on the cleartext-HTTP forward-proxy path. In practice that
meant any agent doing `curl https://...` got tunneled regardless of policy.

Now CONNECT runs the same `evaluateRules(domain, 'CONNECT', '/')` pipeline
the HTTP path uses:
- `[[deny]]` host-match → 403 fast-reject + audit
- `[[grant_required]]` → blocking grant request to the IdP, tunnel only on
  approval, 403/504 on deny/timeout
- `[[allow]]` host-match → tunnel + audit
- unmatched → falls to `default_action`

Rules with `methods` or `path` filters cannot be enforced at CONNECT time
(the TLS payload is opaque), so only domain-only rules match for HTTPS.
This is intentional and documented inline.

### Side-fix: `default_action="allow"`

Adds `'allow'` to the `default_action` union (was: `'block' | 'request' | 'request-async'`).
Previously the matcher only special-cased `'block'` and fell through to
`grant_required` for anything else, so a config saying `default_action="allow"`
would silently route unmatched hosts to a once-grant request — which blocks
or fails when no IdP/grant flow is set up. Matcher now handles `'allow'` as a
hard pass, matching the intent of the config string.

### Internals: shared `GrantsClient` map

`createNodeHandler` now builds a single `Map<email, GrantsClient>` via the
new public `buildGrantsClients(config)` and passes it to both the forward-
proxy fetch path (`createMultiAgentProxy`) and the new CONNECT-side grant
flow. `createMultiAgentProxy` accepts an optional pre-built map for back-
compat; behavior unchanged when called without it.
