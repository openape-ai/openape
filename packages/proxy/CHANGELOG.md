# @openape/proxy

## 0.4.0

### Minor Changes

- [#194](https://github.com/openape-ai/openape/pull/194) [`eb0f82e`](https://github.com/openape-ai/openape/commit/eb0f82e357a11956c7545e50bdabbe46895a597d) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - proxy: distinguish DNS-unresolvable hosts from private/loopback IPs (502 vs 403)

  Previously the SSRF check (`isPrivateOrLoopback`) collapsed three different
  egress conditions into one boolean and surfaced all of them as **403
  Forbidden** with audit `rule=ssrf-blocked`:

  - the host resolves to a private/loopback IP (a real policy refusal)
  - DNS returns no A/AAAA records (NXDOMAIN, NODATA)
  - DNS query itself errors out (timeout, SERVFAIL)

  That made `apes proxy -- curl https://example.at` (a typo) come back as a
  403 — misleading, because the proxy didn't refuse on policy, it just
  couldn't reach an upstream.

  New: `checkEgress(hostname)` returns a discriminated result and callers
  branch on it.

  | outcome        | response            | audit `rule`                  |
  | -------------- | ------------------- | ----------------------------- |
  | `ok`           | forward             | (n/a — proceeds to rules)     |
  | `private`      | **403 Forbidden**   | `ssrf-blocked`                |
  | `unresolvable` | **502 Bad Gateway** | `dns-unresolvable (<reason>)` |

  The `unresolvable` reason is `no-records` (NXDOMAIN/NODATA) or `dns-error`
  (query failure). The audit action is `error` for unresolvable, distinct
  from `deny` so dashboards can separate "policy stopped this" from "we
  couldn't reach the upstream".

  Both proxy entry points are updated: HTTP forward-proxy
  (`handleRequest`) and CONNECT tunnel (`handleConnect`).

  `isPrivateOrLoopback` is kept as a deprecated boolean shim for any
  out-of-tree caller; new callers should use `checkEgress`.

  Drive-by note on DNS-rebinding: the old "block on uncertainty" rationale
  was a weak hedge — a careful attacker can still race the resolution
  between our check and the kernel's `connect()`. The proper mitigation is
  pinning the resolved IP across the actual socket call; conflating
  unresolvable with private was costing us correctness for typos without
  buying meaningful safety.

## 0.3.1

### Patch Changes

- [#189](https://github.com/openape-ai/openape/pull/189) [`1bd0172`](https://github.com/openape-ai/openape/commit/1bd0172453a697ebca2ae18c0669b9a6a49360e6) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - proxy: drop local audit-log file, keep stderr-only summary

  The proxy used to append a JSONL audit record to a local file (default
  `~/.local/state/openape/proxy-audit.jsonl`, configurable via
  `proxy.audit_log`). Two problems with that:

  1. **It can't function as an audit trail.** Anything written on the agent's
     host is also writable by the agent — there's no integrity story we'd be
     willing to put in front of a reviewer. Local files are debugging data, not
     evidence.
  2. **It crashed the proxy on first use.** `appendFileSync` raised ENOENT
     because the default state dir didn't exist on a fresh machine, the
     exception bubbled out of `writeAudit`, tore down the in-flight CONNECT, and
     was misreported as `grant_timeout` by the surrounding `try/catch` of
     `handleConnect`.

  Both issues go away by removing the file path entirely. The stderr summary
  line stays — that's a debugging convenience for the operator running
  `apes proxy --` interactively, not an audit. The trustworthy audit record
  lives server-side on the IdP, recorded for every grant decision; a per-agent
  audit view will be exposed there in a follow-up.

  Removed surfaces:

  - `proxy.audit_log` config field (TOML) — silently ignored if still present in
    legacy configs; nothing reads it.
  - `initAudit()` export from `@openape/proxy` — now no-op semantics, function
    removed.
  - `apes proxy --` no longer emits `audit_log = …` into the auto-generated
    TOML.

  Drive-by: the stderr summary stopped printing `example.comexample.com:443`
  for CONNECT (`domain` and `path` were being concatenated, but CONNECT puts
  `host:port` in `path`).

## 0.3.0

### Minor Changes

- [#177](https://github.com/openape-ai/openape/pull/177) [`cd3e7e6`](https://github.com/openape-ai/openape/commit/cd3e7e6cffbcc5861e8331227a745d87cd4b9db7) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - proxy: host-based allow/deny/grant_required rules now apply at HTTPS CONNECT time

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

### Patch Changes

- [#185](https://github.com/openape-ai/openape/pull/185) [`63e6dd2`](https://github.com/openape-ai/openape/commit/63e6dd2ef98a1fd62a94b8565e5b5c6961279da2) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - proxy: accept the standard `HTTP_PROXY` absolute-URL request line

  `createNodeHandler.handleRequest` previously only understood the legacy
  path-encoded form (`http://proxy:port/<full-target-url>`). Standard
  HTTP_PROXY clients — curl, gh, git, npm, undici — send the target as an
  absolute URL in the request line: `GET http://example.com/path HTTP/1.1`,
  which `node:http` surfaces as `req.url = "http://example.com/path"`. The
  old code concatenated this with the proxy's own host header, producing
  garbage like `http://proxy:portshttp://example.com/path` → "Invalid target
  URL" 400.

  Fix: detect when `req.url` is already absolute and prefix it with a slash
  so the existing `pathname.slice(1)` extraction recovers the same target
  string. Path-form clients (legacy) keep working unchanged.

  Net effect: `apes proxy -- curl http://example.com` returns HTTP 200
  instead of "Invalid target URL". HTTPS-via-CONNECT was unaffected (uses
  `handleConnect`, not `handleRequest`).

## 0.2.15

### Patch Changes

- [`6c13d24`](https://github.com/openape-ai/openape/commit/6c13d244354ac8ce5639923c806922d4c1b46b35) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - proxy + apes: Node-runnable build for `@openape/proxy`, depended on by `@openape/apes`

  `@openape/proxy` is now distributed as a Node-runnable bundle (`dist/index.js` with
  `#!/usr/bin/env node` shebang, exec bit set, target node22) instead of a Bun-only
  TypeScript source. The package's `bin` entry now points at `dist/index.js`, the
  package ships `dist/`, `config.example.toml`, and `README.md`.

  `@openape/apes` adds `@openape/proxy` as a `workspace:*` dependency. This is
  foundation work for the upcoming `apes proxy -- <cmd>` subcommand: a global
  `npm i -g @openape/apes` install will from now on also install the proxy
  binary, and `apes` can locate it via
  `require.resolve('@openape/proxy/package.json')` plus the `bin` field — no
  `bun` runtime required on the user's machine.

  No CLI behavior change today. `apes proxy --` lands in the next milestone.

- [`7b2a7a4`](https://github.com/openape-ai/openape/commit/7b2a7a4aa27173fa15e0fdde6c957059a50bca65) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - apes: new `apes proxy -- <cmd>` subcommand routes commands through the egress proxy

  ```bash
  apes proxy -- curl https://api.github.com/zen
  apes proxy -- gh repo list
  apes proxy -- bash -c 'curl https://...'
  ```

  The subcommand mirrors the orchestration shape of `apes run --root → escapes`:
  it is a thin wrapper that owns the _lifecycle_, not the policy. The actual
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

## 0.2.14

### Patch Changes

- Updated dependencies [[`d7f78fa`](https://github.com/openape-ai/openape/commit/d7f78fa68478f295202351e15bfada8ce849c4db)]:
  - @openape/core@0.13.2
  - @openape/grants@0.11.2

## 0.2.13

### Patch Changes

- Updated dependencies [[`ed1ad3f`](https://github.com/openape-ai/openape/commit/ed1ad3f6cd7d8ed2c9309cabda503d3ecf6453ff)]:
  - @openape/core@0.13.1
  - @openape/grants@0.11.1

## 0.2.12

### Patch Changes

- Updated dependencies [[`d1c8f5a`](https://github.com/openape-ai/openape/commit/d1c8f5a711b088ac160c92d67a532f6f4d77d437)]:
  - @openape/grants@0.11.0

## 0.2.11

### Patch Changes

- Updated dependencies [[`d8e1516`](https://github.com/openape-ai/openape/commit/d8e15161d7edda67139633ec18c959a2cc8a57bd)]:
  - @openape/grants@0.10.0

## 0.2.10

### Patch Changes

- Updated dependencies [[`03edf70`](https://github.com/openape-ai/openape/commit/03edf70c9aa73a362cc3376d3a8f8e041620d054)]:
  - @openape/core@0.13.0
  - @openape/grants@0.9.0

## 0.2.9

### Patch Changes

- Updated dependencies [[`6c0cbad`](https://github.com/openape-ai/openape/commit/6c0cbada5165dc4e45381ffdaca847cd9dfc1d02)]:
  - @openape/grants@0.8.0

## 0.2.8

### Patch Changes

- Fix ReDoS-vulnerable regex in proxy auth header parsing. Fix lint violations across packages. Update import paths for CLI permissions moved to @openape/grants.

- Updated dependencies []:
  - @openape/core@0.12.0
  - @openape/grants@0.7.0

## 0.2.7

### Patch Changes

- Updated dependencies []:
  - @openape/core@0.11.0
  - @openape/grants@0.6.0

## 0.2.6

### Patch Changes

- Updated dependencies [[`da8a5ac`](https://github.com/openape-ai/openape/commit/da8a5acf82542810ecddf4ad7a9ac8b7b1cfd287)]:
  - @openape/core@0.10.0
  - @openape/grants@0.5.3

## 0.2.5

### Patch Changes

- Updated dependencies [[`bd1eb0d`](https://github.com/openape-ai/openape/commit/bd1eb0d83f700f1c289d21a545d3d62ced7f44d6)]:
  - @openape/core@0.8.0
  - @openape/grants@0.5.2

## 0.2.4

### Patch Changes

- Relicense from AGPL-3.0-or-later to MIT, rename OpenAPE to OpenApe

- Updated dependencies []:
  - @openape/grants@0.5.1
  - @openape/core@0.7.1

## 0.2.3

### Patch Changes

- Updated dependencies []:
  - @openape/core@0.7.0
  - @openape/grants@0.5.0

## 0.2.2

### Patch Changes

- [#1](https://github.com/openape-ai/openape/pull/1) [`3f0a62f`](https://github.com/openape-ai/openape/commit/3f0a62f25b07623d13f4e450683133415807358f) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Align implementation with DDISA spec v1.0-draft

  **@openape/core:**

  - **BREAKING:** `OpenApeGrantRequest.target` → `target_host` (host/domain), `audience` now REQUIRED
  - `OpenApeAuthZClaims` gets `target_host` as REQUIRED claim
  - Fix error status codes: `invalid_audience`/`invalid_nonce` → 401, `grant_not_approved` → 400, `grant_already_used` → 410
  - Add missing error types: `policyDenied`, `invalidPkce`, `invalidState`

  **@openape/grants:**

  - **BREAKING:** `issueAuthzJWT` sets `aud` from `audience` (not `target`), adds `target_host` + `run_as` claims

  **@openape/nuxt-auth-idp:**

  - Grant creation validates `target_host` + `audience` (REQUIRED)
  - Fix `ddisa_version` from `'ddisa1'` to `'1.0'`
  - Fix `ddisa_auth_methods_supported` from `'passkey'` to `'webauthn'`
  - Grant/Delegation create now returns HTTP 201
  - Batch endpoint: `body.actions` → `body.operations`, response includes `success` boolean
  - Delegation validate returns `{ valid, delegation, scopes }` instead of ProblemDetails
  - **BREAKING:** `authzJWT` → `authz_jwt` in approve/token API responses (snake_case per OAuth2)
  - Delegation list supports `?role=delegator|delegate` query parameter

  **@openape/grapes:**

  - **BREAKING:** Replace `exec` command with audience-first `run` command
  - `request` command uses `--audience` + `--host` instead of `--for`
  - Remove `defaults.for` from config

  **@openape/proxy:**

  - Update `GrantsClient` to use `targetHost` + `audience` parameters

- Updated dependencies [[`3f0a62f`](https://github.com/openape-ai/openape/commit/3f0a62f25b07623d13f4e450683133415807358f)]:
  - @openape/core@0.6.0
  - @openape/grants@0.4.0
