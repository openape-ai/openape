# Local Containerized Test Stack + Screenshot Docs — Design

**Status:** Draft (awaiting review)
**Date:** 2026-06-09
**Author:** Patrick Hofmann (Delta Mind) + Claude

## Goal

A developer runs **one command** and gets the whole OpenApe web stack — IdP + two
SP apps — running locally **in containers under real `https://*.openape.test`
hostnames**, mirroring the chatty/prod topology (subdomains, TLS, DNS-based DDISA
discovery). A second command drives **2–3 real user flows in a headless browser**
and drops **screenshots + a markdown guide per flow** into `docs/local-stack/`.

What the user can do after this exists that they couldn't before:
- `docker compose -f compose/local-stack.yml up -d --build` → full stack at
  `https://id.openape.test`, `https://troop.openape.test`, `https://chat.openape.test`.
- `docker compose -f compose/local-stack.yml run --rm playwright` → fresh
  screenshots of passkey sign-up + DDISA SSO into two SPs, assembled into docs.

## Demo scope (now)

- **Apps:** `idp` (openape-free-idp), `troop`, `chat`. (`nest` + `llm` are already
  containerized; agent flows = a deferred 4th flow needing nest↔troop onboarding.)
- **3 flows:** (1) passkey sign-up at the IdP, (2) DDISA SSO login into troop,
  (3) one-click SSO into chat with the same passkey.

## Architecture

One docker network `openape-test`. Everything talks via real FQDNs over `https`.

| Service      | Image / build                              | Role                                                        |
|--------------|--------------------------------------------|-------------------------------------------------------------|
| `dns`        | `dnsmasq` (alpine + dnsmasq)               | Serves the DDISA **TXT** for `openape.test` + forwards A queries to docker's embedded DNS (`127.0.0.11`). Static IP so apps can point `dns:` at it. |
| `proxy`      | `caddy:2`                                  | TLS terminator (`tls internal` → local CA) + Host-routing reverse proxy. Network aliases `id|troop|chat.openape.test`. Publishes `127.0.0.1:443`. |
| `idp`        | build `compose/Nuxt.Dockerfile` (free-idp) | DDISA IdP, issuer `https://id.openape.test`, internal `:3003`. |
| `troop`      | build `compose/Nuxt.Dockerfile` (troop)    | SP, internal `:3010`.                                         |
| `chat`       | build `compose/Nuxt.Dockerfile` (chat)     | SP, internal `:3007`.                                         |
| `playwright` | build `compose/demo/Dockerfile`            | Headless-Chromium runner on the same network; captures screenshots. Run on demand. |

### DNS (the "komplett simuliert" part)

- `proxy` carries docker **network aliases** `id.openape.test`, `troop.openape.test`,
  `chat.openape.test` → docker's embedded DNS resolves those names to Caddy.
- `dns` (dnsmasq) serves the DDISA discovery **TXT** record:
  `txt-record=openape.test,"v=ddisa1; idp=https://id.openape.test"` and forwards
  everything else (`server=127.0.0.11`) so A-lookups for `*.openape.test` still
  resolve to Caddy via the aliases.
- `idp`, `troop`, `chat`, `playwright` set `dns: ["<dnsmasq-static-ip>"]` so their
  resolver is dnsmasq (TXT + forwarded A). `proxy` keeps default DNS (it only needs
  to resolve the service names `idp`/`troop`/`chat` it proxies to).
- **Result:** the SP performs the **real** DDISA discovery (TXT lookup for the
  email domain `openape.test`) instead of an `NUXT_OPENAPE_URL` override — the
  discovery path is exercised, not bypassed.
- Optional host access: a one-line `/etc/resolver/openape.test` (`nameserver
  127.0.0.1` + dnsmasq's published port) lets Patrick's own Mac browser open
  `https://id.openape.test`. Not required for the Playwright screenshots (the
  runner is in-network).

### TLS

- Caddy `tls internal` auto-issues certs for the three hostnames from its local CA.
- Node-to-Node (SP→IdP discovery/validation, IdP→SP `/.well-known` fetch) must
  **trust** that CA — never disable verification (a disabled check is a real
  MITM hole even locally, and it wouldn't mirror prod). Approach: Caddy writes its
  root CA to a shared volume; a tiny init step copies it to `/certs/root.crt`; the
  app containers set `NODE_EXTRA_CA_CERTS=/certs/root.crt`. App services
  `depends_on` `proxy` being healthy so the CA exists before they boot.
- Browser: Playwright launches Chromium with `--ignore-certificate-errors` (and
  `ignoreHTTPSErrors: true` on the context). The origin is still `https://…` →
  a proper **secure context** → WebAuthn works **without** the
  `--unsafely-treat-insecure-origin-as-secure` hack.

## Components (new files)

1. `compose/Nuxt.Dockerfile` — *one* parameterized multi-stage Dockerfile.
   Build args: `APP_FILTER` (turbo filter, e.g. `@openape/troop`), `APP_DIR`
   (path under `apps/` to copy `.output` from), `PORT`. Build stage = monorepo
   context, `pnpm install --frozen-lockfile --ignore-scripts` + `turbo run build
   --filter $APP_FILTER`; runtime stage = `node:22-bookworm-slim` + the app's
   self-contained `.output`, `CMD ["node", ".output/server/index.mjs"]`. (Mirrors
   the approved pattern in `2026-06-05-troop-docker-deploy-design.md`.)
2. `compose/local-stack.yml` — the 6 services above, the `openape-test` network
   (subnet + dnsmasq static IP), healthchecks, env (below), ephemeral file DBs.
3. `compose/dnsmasq.conf` — TXT record + `server=127.0.0.11`.
4. `compose/Caddyfile` — `tls internal`, three `id|troop|chat.openape.test` site
   blocks each `reverse_proxy` to the matching service:port, with
   `header_up X-Forwarded-Proto https`.
5. `compose/demo/Dockerfile` — `mcr.microsoft.com/playwright:v1.x` base + the spec.
6. `compose/demo/screenshot.spec.ts` — the 3-flow Playwright script (virtual
   authenticator + screenshots).
7. `docs/local-stack/README.md` + `docs/local-stack/<flow>.md` (×3) — guides
   embedding the captured screenshots; `docs/local-stack/screenshots/` holds the PNGs.

## Per-service env (local DDISA + TLS)

**idp:**
```
NUXT_OPENAPE_ISSUER=https://id.openape.test
NUXT_OPENAPE_RP_ID=id.openape.test
NUXT_OPENAPE_RP_ORIGIN=https://id.openape.test
NUXT_OPENAPE_RP_HOST_ALLOWLIST=id.openape.test
NUXT_OPENAPE_SESSION_SECRET=<dev-32+>
NUXT_OPENAPE_MANAGEMENT_TOKEN=<dev>
NITRO_PORT=3003 ; HOST=0.0.0.0
NODE_EXTRA_CA_CERTS=/certs/root.crt
```
**troop / chat** (per app, ports 3010 / 3007):
```
# No NUXT_OPENAPE_URL → real DDISA discovery via DNS TXT.
NUXT_OPENAPE_SP_FALLBACK_IDP_URL=https://id.openape.test
NUXT_PUBLIC_IDP_URL=https://id.openape.test
NUXT_OPENAPE_CLIENT_ID=           # empty → host-derived (troop.openape.test)
NUXT_OPENAPE_SP_SESSION_SECRET=<dev-32+>
NITRO_PORT=<3010|3007> ; HOST=0.0.0.0
NODE_EXTRA_CA_CERTS=/certs/root.crt
```
(troop's `NUXT_TURSO_URL=file:./openape-troop.db` default is fine; chat needs VAPID
only for push — optional for the demo, can boot without.)

## The 3 flows (Playwright)

Setup once: CDP `WebAuthn.enable` + `WebAuthn.addVirtualAuthenticator` (ctap2,
internal transport, resident keys + UV on) → the passkey persists across the
context, so flows 2–3 reuse it.

1. **Passkey sign-up** — `goto https://id.openape.test` → enter email
   `demo@openape.test` → register passkey (virtual authenticator auto-satisfies the
   ceremony) → IdP dashboard. Screens: `01-idp-landing`, `02-passkey-prompt`,
   `03-idp-dashboard`.
2. **DDISA SSO → troop** — `goto https://troop.openape.test` → login → redirect to
   `https://id.openape.test/authorize…` (SP discovered the IdP via DNS TXT) →
   authorize with the existing passkey → back to troop dashboard. Screens:
   `04-troop-landing`, `05-idp-authorize`, `06-troop-dashboard`.
3. **One-click SSO → chat** — same context `goto https://chat.openape.test` →
   login → IdP session already present → instant authorize → chat dashboard (no
   second passkey prompt). Screens: `07-chat-landing`, `08-chat-dashboard`.

Each `page.screenshot()` writes to a mounted `./docs/local-stack/screenshots/`.

## Docs output

- `docs/local-stack/README.md` — how to bring the stack up + run the flows; the
  topology table; the `/etc/resolver` host-access note.
- `docs/local-stack/01-passkey-signup.md`, `02-sso-troop.md`, `03-sso-chat.md` —
  one guide per flow: numbered steps, each embedding its screenshot. Authored to
  reference the test's screenshot filenames (test = source of truth for the images;
  full step-text auto-generation is a later enhancement).

## Verification (definition of done for the demo)

1. `docker compose -f compose/local-stack.yml up -d --build` → `docker compose ps`
   shows idp/troop/chat/proxy/dns healthy.
2. `curl -k https://id.openape.test/` from inside the `playwright` container returns
   200 (proves DNS + TLS + routing).
3. `docker compose run --rm playwright` exits 0 and writes **8 PNGs** to
   `docs/local-stack/screenshots/`.
4. The three markdown guides render with the embedded screenshots.
5. The screenshots visibly show real `https://*.openape.test` URLs and the
   authenticated dashboards (SSO into chat shows **no** second passkey prompt).

## Deferred (explicitly out of scope for the demo)

- `nest` + `llm` in the stack and an **agent flow** (nest onboarding via the local
  troop + a service-agent task) — a natural 4th flow; the stack is built so they
  bolt on.
- `org` app, `docs` app.
- Auto-generating the guide *prose* from test steps (we embed test-captured
  screenshots into authored markdown for now).
- Host-wide trusted certs via `mkcert` (only needed if Patrick browses the stack
  from his own Mac browser without cert warnings).

## Risks & mitigations

- **Caddy CA timing** (apps start before the CA exists) → `depends_on: proxy
  (condition: service_healthy)` + an init that waits for `/certs/root.crt` before
  the app boots. We do **not** disable TLS verification as a workaround.
- **dnsmasq forwarding** loses docker service-name resolution → `server=127.0.0.11`
  forward keeps it; `proxy` keeps default DNS so its `reverse_proxy` targets resolve.
- **Virtual authenticator / RP_ID mismatch** → RP_ID `id.openape.test` is a
  registrable suffix of origin `https://id.openape.test`; UV+resident-keys on.
- **App boots needing an env we missed** → per the memory lesson, after build run
  the container and hit the route before declaring done; typecheck won't catch
  missing runtime env.
- **Real DDISA discovery falls through to DoH** (would bypass dnsmasq) → resolver
  tries native DNS first (hits dnsmasq); if flaky, set the per-app
  `NUXT_OPENAPE_URL=https://id.openape.test` override as a fallback (keeps the demo
  working, loses only the "real discovery" bonus).
