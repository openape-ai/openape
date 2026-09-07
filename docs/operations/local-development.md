# Local development and fixtures

Prepare the [session toolchain](session-toolchain.md), install the pinned
dependencies and use the shared pre-build/check contract.
Every command below comes from the app's package.json. CLI watch commands build
code; they do not imply an HTTP service is listening.

For a browser login with real DNS/TLS and an isolated IdP, use the existing
[local Docker stack](../local-stack/README.md):

```sh
docker compose -f compose/local-stack.yml up -d --build
```

The stack defines IdP, troop, chat, tasks, plans, testrun, timetrack, CRM, ape-pr
and the public docs site, plus DNS/TLS infrastructure. The authoritative list
is `docker compose -f compose/local-stack.yml config --services`. The optional
demo and agent-lifecycle profiles add test drivers. Its DNS/resolver and local
CA setup are documented there. Do not point local experiments at production data,
disable authentication to enter a private UI, or reset existing stack volumes
merely to run a test.

For automated app authentication use `startIdp()` from
[the shared fixture](../../examples/e2e/helpers/idp-fixture.ts), with a temporary
store, a generated management token and test-domain DDISA records. Register test
users/keys using [bootstrap helpers](../../examples/e2e/helpers/bootstrap.ts)
and exercise the real challenge/response with
[key-auth](../../examples/e2e/helpers/key-auth.ts). Always stop fixtures in test
cleanup. The CLI round-trip suites in ape-pr and testrun demonstrate an isolated
SP database, local issuer discovery and signed token verification. UI-state tests
mount components with Nuxt-UI stubs; geometry tests use a real browser.

## App entry points

| Workspace | Start | Configuration source | Login / test data | Available checks |
|---|---|---|---|---|
| `docs` | `pnpm --filter docs dev` → `nuxt dev` | [apps/docs/nuxt.config.ts](../../apps/docs/nuxt.config.ts) | Kein SP-Login; Laufzeit-/CLI-Konfiguration im Paket lesen. | `test`, `typecheck` |
| `@openape/ape-agent` | `pnpm --filter @openape/ape-agent dev` → `tsup --watch` | [apps/openape-ape-agent/package.json](../../apps/openape-ape-agent/package.json) | Kein SP-Login; Laufzeit-/CLI-Konfiguration im Paket lesen. | `test`, `typecheck` |
| `@openape/chat` | `pnpm --filter @openape/chat dev` → `nuxt dev --port 3007` | [apps/openape-chat/nuxt.config.ts](../../apps/openape-chat/nuxt.config.ts) | Lokaler IdP + leere lokale App-Datenbank; CLI-/UI-Daten app-spezifisch anlegen. | `test`, `typecheck` |
| `@openape/ape-chat` | `pnpm --filter @openape/ape-chat dev` → `tsup --watch` | [apps/openape-chat-cli/package.json](../../apps/openape-chat-cli/package.json) | Kein SP-Login; Laufzeit-/CLI-Konfiguration im Paket lesen. | `typecheck` |
| `@openape-crm/app` | `pnpm --filter @openape-crm/app dev` → `nuxt dev --port 3024` | [apps/openape-crm/nuxt.config.ts](../../apps/openape-crm/nuxt.config.ts) | Lokaler IdP + leere lokale App-Datenbank; CLI-/UI-Daten app-spezifisch anlegen. | `test`, `typecheck` |
| `@openape-dashboard/app` | `pnpm --filter @openape-dashboard/app dev` → `nuxt dev --port 3022` | [apps/openape-dashboard/nuxt.config.ts](../../apps/openape-dashboard/nuxt.config.ts) | Lokaler IdP + leere lokale App-Datenbank; CLI-/UI-Daten app-spezifisch anlegen. | `test`, `typecheck` |
| `openape-free-idp` | `pnpm --filter openape-free-idp dev` → `nuxt dev --port 3002` | [apps/openape-free-idp/nuxt.config.ts](../../apps/openape-free-idp/nuxt.config.ts) | IdP-Fixture mit isoliertem Store und Testidentitäten. | `test`, `test:e2e`, `typecheck` |
| `@openape-git/app` | `pnpm --filter @openape-git/app dev` → `nuxt dev --port 3026` | [apps/openape-git/nuxt.config.ts](../../apps/openape-git/nuxt.config.ts) | Lokaler IdP + leere lokale App-Datenbank; CLI-/UI-Daten app-spezifisch anlegen. | `test`, `typecheck` |
| `@openape-monitor/app` | `pnpm --filter @openape-monitor/app dev` → `nuxt dev --port 3018` | [apps/openape-monitor/nuxt.config.ts](../../apps/openape-monitor/nuxt.config.ts) | Lokaler IdP + leere lokale App-Datenbank; CLI-/UI-Daten app-spezifisch anlegen. | `test`, `typecheck` |
| `@openape/nest` | `pnpm --filter @openape/nest dev` → `tsup --watch` | [apps/openape-nest/package.json](../../apps/openape-nest/package.json) | Kein SP-Login; Laufzeit-/CLI-Konfiguration im Paket lesen. | `test`, `typecheck` |
| `@openape-plans/app` | `pnpm --filter @openape-plans/app dev` → `nuxt dev --port 3004` | [apps/openape-plans/nuxt.config.ts](../../apps/openape-plans/nuxt.config.ts) | Lokaler IdP + leere lokale App-Datenbank; CLI-/UI-Daten app-spezifisch anlegen. | `test`, `typecheck` |
| `@openape-pr/app` | `pnpm --filter @openape-pr/app dev` → `nuxt dev --port 3014` | [apps/openape-pr/nuxt.config.ts](../../apps/openape-pr/nuxt.config.ts) | Lokaler IdP + leere lokale App-Datenbank; CLI-/UI-Daten app-spezifisch anlegen. | `test`, `test:e2e`, `typecheck` |
| `@openape-question-service/app` | `pnpm --filter @openape-question-service/app dev` → `nuxt dev --port 3017` | [apps/openape-question-service/nuxt.config.ts](../../apps/openape-question-service/nuxt.config.ts) | Lokaler IdP + leere lokale App-Datenbank; CLI-/UI-Daten app-spezifisch anlegen. | `typecheck` |
| `@openape-secrets/app` | `pnpm --filter @openape-secrets/app dev` → `nuxt dev --port 3025` | [apps/openape-secrets/nuxt.config.ts](../../apps/openape-secrets/nuxt.config.ts) | Lokaler IdP + leere lokale App-Datenbank; CLI-/UI-Daten app-spezifisch anlegen. | `test`, `typecheck` |
| `@openape-tasks/app` | `pnpm --filter @openape-tasks/app dev` → `nuxt dev --port 3005` | [apps/openape-tasks/nuxt.config.ts](../../apps/openape-tasks/nuxt.config.ts) | Lokaler IdP + leere lokale App-Datenbank; CLI-/UI-Daten app-spezifisch anlegen. | `test`, `typecheck` |
| `@openape-testrun/app` | `pnpm --filter @openape-testrun/app dev` → `nuxt dev --port 3006` | [apps/openape-testrun/nuxt.config.ts](../../apps/openape-testrun/nuxt.config.ts) | Lokaler IdP + leere lokale App-Datenbank; CLI-/UI-Daten app-spezifisch anlegen. | `test`, `test:e2e`, `test:layout`, `typecheck` |
| `@openape-timetrack/app` | `pnpm --filter @openape-timetrack/app dev` → `nuxt dev --port 3011` | [apps/openape-timetrack/nuxt.config.ts](../../apps/openape-timetrack/nuxt.config.ts) | Lokaler IdP + leere lokale App-Datenbank; CLI-/UI-Daten app-spezifisch anlegen. | `test`, `typecheck` |
| `@openape/troop` | `pnpm --filter @openape/troop dev` → `nuxt dev --port 3010` | [apps/openape-troop/nuxt.config.ts](../../apps/openape-troop/nuxt.config.ts) | Lokaler IdP + leere lokale App-Datenbank; CLI-/UI-Daten app-spezifisch anlegen. | `test`, `test:layout`, `typecheck` |

## Environment rules

Most SP apps have `file:./dev.db` and development session defaults. To isolate a
run, set `NUXT_TURSO_URL=file:<temporary-path>` and
`NUXT_OPENAPE_SP_SESSION_SECRET` to a generated development secret. The `openapeSp`
runtime namespace uses `NUXT_OPENAPE_SP_*`; legacy build-time variables found in
individual nuxt.config.ts files are not universal runtime variables.

For local issuer tests, configure the fixture's DDISA records and issuer URL;
the existing SP round-trip fixtures explicitly permit their loopback test issuer
inside that isolated test process. Do not export those development switches into
a general shell or production environment. UI login through production IdP is
not a substitute for a tested local callback/discovery configuration.

The forge additionally uses `NUXT_GIT_DATA_DIR` for an isolated bare-repository
store and `NUXT_IDP_URL` for Git transport verification. IdP tests use the
fixture's temporary data directory and management API. Mail, payments, DNS
provisioning and other integrations are optional/external dependencies: configure
only the capability being exercised and never copy production .env files.

Tasks uses 3005 and ape-pr uses 3014, matching their deployment port allocation.
Plans remains on 3004 and testrun on 3006. `pnpm run doctor -- --services --app NAME`
reports whether the selected explicit port already has a TCP listener. It does
not assume that listener belongs to the intended app. Choose another explicit
port for parallel instances of the same app.
