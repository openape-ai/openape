# Architecture

This document is the 10-minute map of the repo: what the system does, what it
is made of, what runs where, and which non-obvious decisions you must know
before changing anything. It is regenerated from the code (see
`.claude/agents/arch-extract.md`); canonical detail lives in the linked files,
not here.

## What this is

OpenApe is the reference implementation of **DDISA** (DNS-Discoverable
Identity & Service Authorization): users sign in anywhere on the open web with
their e-mail domain and a passkey — no passwords, no per-app accounts. A
service provider (SP) looks up a DNS TXT record on the user's mail domain to
discover their identity provider (IdP), then runs an OIDC-style PKCE flow
against it; authorization happens through revocable grants instead of blanket
sessions. On top of that identity layer sits an agent platform: AI agents get
the same first-class DDISA identities as humans, run as supervised processes
on machines their owners control ("nests"), and talk to their owners through a
shared chat. The protocol itself is specified in a separate repo —
[openape-ai/protocol](https://github.com/openape-ai/protocol) (`core.md`,
`grants.md`, `delegation.md`); this monorepo implements it and must not
silently diverge (see `.claude/CLAUDE.md`, "DDISA Protocol Compliance").

## Building blocks

Three workspace layers, in dependency order (pnpm workspace + Turborepo, all
internal deps via `workspace:*`):

**`packages/` — publishable libraries.** The protocol core and everything
shared:

- `packages/core` — types, DNS resolver (`src/dns/resolver.ts`), JWT, PKCE.
  Depends on nothing internal; everything depends on it.
- `packages/auth` — the IdP and SP halves of the OIDC protocol logic
  (`src/idp/`, `src/sp/`), framework-free.
- `packages/grants` — grant issuance, revocation, introspection.
- `packages/server` — programmatic DDISA IdP/SP on h3; security hardening
  (rate limits, headers, timing-safe comparisons) lives and is tested here.
- `packages/apes` — the `apes` CLI + MCP server, the user-facing entry point
  (`apes login`, `apes agents spawn`, …); `packages/cli-auth` is the shared
  SSO store all OpenApe CLIs read.
- `packages/agent-runtime` — the in-process LLM run loop and agent tools.
- Plus supporting libs: `proxy` (grant-gated HTTP gateway), `browser`
  (grant-aware Playwright), `shapes`, `sp-tasks`, `codex-proxy`,
  `prompt-injection-detector`, `s3-driver`, `vue-components`, and private
  test suites (`idp-test-suite`, `protocol-conformance`).

**`modules/` — the two DDISA roles as Nuxt modules.** Any Nuxt app becomes an
IdP by adding `modules/nuxt-auth-idp` (passkey auth, OAuth endpoints, account
management, admin) or an SP by adding `modules/nuxt-auth-sp` (login via DNS
discovery, callback, session, well-known endpoints). The web apps below are
thin shells around exactly these modules (see their `nuxt.config.ts`).

**`apps/` — deployables.** Three self-hosted Nuxt web apps:
`apps/openape-free-idp` (the free IdP, id.openape.ai — uses `nuxt-auth-idp`),
`apps/openape-troop` (agent control plane, includes the company/org view) and
`apps/openape-chat` (human↔agent chat) — the latter two are SPs using
`nuxt-auth-sp`. Beside them: `apps/openape-nest` (local daemon supervising
agents on a machine), `apps/openape-ape-agent` (one runtime process per
agent), `apps/openape-llm` (LiteLLM proxy container), `apps/docs`
(documentation site, statically prerendered).

**`examples/`** — minimal IdP/SP apps, the `examples/e2e` integration tests,
and `examples/agent-recipes`.

Publishing is Changesets-based; `scripts/publish-chain.mjs` (`pnpm release`)
publishes the `@openape/*` packages to npm in dependency order.

## Runtime topology

### Production (host "chatty")

The three web apps run as Docker containers from `registry.openape.ai`,
orchestrated by `compose/chatty.yml`, each publishing on `127.0.0.1:<port>`
behind nginx:

| Service | App | Port | Domain |
|---|---|---|---|
| `idp` | openape-free-idp | 3003 | id.openape.ai |
| `troop` | openape-troop | 3010 | troop.openape.ai |
| `chat` | openape-chat | 3007 | chat.openape.ai |

Each container mounts the pre-existing `/home/openape/projects/<app>/shared`
at the identical path and reuses its `.env` — SQLite `file:` URLs and secrets
never move. `apps/docs` is deployed separately as static files
(`scripts/deploy-docs.sh`).

### Agent runtime (user machines)

A **nest** (`apps/openape-nest`) is a long-lived daemon on a machine the owner
controls. It holds an outbound-only WebSocket to troop (no inbound ports),
receives spawn/destroy commands, and supervises one `ape-agent` process
(`apps/openape-ape-agent`) per agent. Each agent has its own DDISA identity at
the IdP, connects to chat as itself, and runs its LLM loop against an
OpenAI-compatible proxy (`apps/openape-llm`). `compose/docker-compose.yml`
packages nest + llm as a two-container pod for any Docker host.

### Local stack

`compose/local-stack.yml` reproduces the whole web topology in containers
under real `https://*.openape.test` hostnames: a dnsmasq container serves the
DDISA discovery TXT record, Caddy terminates TLS with a local CA, and the four
apps run exactly as in prod. Two opt-in profiles extend it: `demo` (a
Playwright runner that captures the user-story guides, `compose/demo/run.sh`)
and `agent-lifecycle` (a mock LLM + a containerized nest for full
spawn→run→destroy tests, `compose/agent/run.sh`).

### How a login flows

1. The user enters their e-mail on an SP. The SP's
   `modules/nuxt-auth-sp/src/runtime/server/api/login.post.ts` extracts the
   domain and calls `discoverIdP` (`packages/auth/src/sp/discovery.ts`),
   which resolves the `v=ddisa1 idp=…` DNS TXT record via
   `packages/core/src/dns/resolver.ts` (configurable fallback IdP if the
   domain has none).
2. The SP builds a PKCE-S256 authorization URL
   (`packages/auth/src/sp/auth-url.ts`), stores the flow state, and redirects
   the browser to the IdP's `/authorize`.
3. The IdP (`modules/nuxt-auth-idp`, logic in
   `packages/auth/src/idp/authorize.ts` + `src/idp/webauthn/`) authenticates
   the user with a WebAuthn passkey and collects consent; SPs need no
   pre-registration — the IdP fetches the SP's
   `/.well-known/oauth-client-metadata` instead.
4. The IdP redirects back with a single-use code; the SP's
   `api/callback.get.ts` exchanges it at the IdP's `/token`
   (`packages/auth/src/sp/callback.ts`), verifies the JWT (issuer, audience,
   signature via JWKS), and sets an HttpOnly session cookie.

CLIs reuse the same flow once per device (`apes login`), then exchange the
IdP token for SP-scoped tokens via RFC 8693 (`packages/cli-auth`).

## How code gets to production

1. **Issue-first development** (`CONTRIBUTING.md`): every change starts from a
   GitHub issue, on a `<type>/issue-<nr>-…` branch, lands via PR. Git hooks
   (`.githooks/`) and a Claude hook block source edits directly on `main`.
2. **CI on git.openape.ai** (Forgejo — the canonical remote; GitHub is a
   read-only mirror. Workflows in `.forgejo/workflows/`): `ci.yml` runs
   lint/typecheck/test/build with turbo
   `--affected` (only changed packages + dependents); `e2e.yml` runs the
   self-contained `examples/e2e` suite; `preview.yml` builds per-app PR
   preview images on a Mac runner and deploys them via Coolify to
   `https://<app>-pr-<n>.preview.openape.ai`.
3. **Tested-image deploy** (`scripts/deploy-image.mjs`,
   `pnpm run deploy:image <target…|--all>`): the maintainer's Mac builds the
   app with warm turbo caches, packages the `.output` into a COPY-only amd64
   image (`compose/preview-package.Dockerfile`, tag `prod-<sha>`), smoke-tests
   `/api/health` locally, pushes to `registry.openape.ai`, then chatty pulls
   and restarts that one compose service. An external health gate follows;
   on failure the tag pin (`<APP>_TAG_PREV`) is reverted automatically.
   There is no build step on the prod host.

## Non-obvious decisions (read before changing things)

- **Story canon as the only hand input.** Product work starts as a user story
  in `stories/` with a `draft → consistent → approved → red → green →
  documented` lifecycle (`stories/README.md`); acceptance criteria, tests,
  code and guides are derived by the agents in `.claude/agents/`. The single
  hard human gate is story approval; `stories/VISION.md` is the compressed
  product canon with a single writer (the consistency agent).
- **User guides are generated from E2E tests.** A "story" in
  `compose/demo/story-kit.mjs` is a real Playwright test whose step captions
  *are* the guide text; if the test fails, the guide entry does not exist, so
  docs cannot drift from the product. `compose/distribute-docs.mjs` ships the
  captured manifests + screenshots into each app's `/docs` pages.
- **COPY-only prod images.** Prod images contain a prebuilt `.output` only —
  the same artifact format as PR previews — so the image that passed the
  smoke test is byte-for-byte what runs in prod, and image builds take
  seconds. The old systemd units stay installed but disabled as a dormant
  fallback; containers run as the same uid/gid so either path owns the DBs.
- **The local stack is the real thing, not a mock.** DDISA discovery needs
  DNS and WebAuthn needs HTTPS, so `compose/local-stack.yml` runs real DNS
  (dnsmasq TXT records) and real TLS (Caddy local CA) under `*.openape.test`
  instead of stubbing either. Passkeys are driven via Chromium's CDP virtual
  authenticator (`compose/demo/run-stories.mjs`).
- **Protocol changes are guarded.** Anything touching discovery, auth flow,
  JWT claims, grants, delegation, error format or well-known endpoints must
  be checked against the spec repo first — divergence requires explicit
  human sign-off (`.claude/CLAUDE.md`).
- **Definition of done is mechanical.** `pnpm lint` and `pnpm typecheck`
  green before any commit or deploy; app changes additionally build the app
  (`.claude/CLAUDE.md`, "Workflow: Definition of Done").
