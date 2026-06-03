# OpenApe Konsolidierung — Phase 1, M4 (SP-SDK) Plan

**Goal:** Die wortgleiche SP-Boilerplate (Server: cli-token/ddisa-issuer/exchange; CLI: apiCall/config/output) in geteilte Libs ziehen, sodass ein SP nur noch Konfiguration liefert.

**Architecture:** Server-Boilerplate → `@openape/nuxt-auth-sp` (parametriert über bestehendes `openapeSp`-Config via `getSpConfig()`). CLI-Boilerplate → `@openape/cli-auth` als `createSpClient({...})`-Factory. Beweis der API end-to-end im Monorepo durch Migration von `apps/openape-chat` (Server) + `openape-chat-cli` (CLI). Externe Satelliten (tasks/plans/timetrack) folgen als Publish+PR (separater Checkpoint).

**Tech Stack:** Nuxt-Modul (nuxt-auth-sp), h3/nitro, tsup (cli-auth), Vitest, pnpm/turbo.

## Slice 1 — Server (nuxt-auth-sp + chat)
- In `modules/nuxt-auth-sp/src/runtime/server/utils/` generalisierte Utils ergänzen, basierend auf den chat-Kopien `apps/openape-chat/server/utils/{cli-token,ddisa-issuer}.ts` (61+49 Zeilen) und `apps/openape-chat/server/api/cli/exchange.post.ts` (96 Zeilen). Issuer/Audience aus `getSpConfig()` (clientId) statt hartkodiert.
- Exportiere einen `createCliExchangeHandler()` (oder Äquivalent nach Modul-Konvention), sodass der Consumer-Route auf ~2 Zeilen schrumpft.
- `apps/openape-chat` migrieren: eigene `cli-token.ts`/`ddisa-issuer.ts` löschen, `server/api/cli/exchange.post.ts` auf den Modul-Handler reduzieren. Verhalten identisch (Issuer = chat-Domain).
- **Beweis:** `pnpm lint && pnpm typecheck && pnpm test` grün; `apps/openape-chat` baut; die 3 chat-Kopien sind weg bzw. auf Re-Export reduziert.

## Slice 2 — CLI (cli-auth + chat-cli)
- In `@openape/cli-auth` eine `createSpClient({ defaultEndpoint, envVar, configFile, defaultAud })`-Factory ergänzen, die `apiCall`, `resolveEndpoint`, Config-FS-Helper und Output-Helper kapselt (basierend auf `openape-chat-cli/src/{api,config,output}.ts`, 124+81+15 Zeilen).
- `openape-chat-cli` migrieren: die drei Dateien durch den Factory-Aufruf ersetzen; Verhalten identisch.
- **Beweis:** `pnpm lint && pnpm typecheck && pnpm test` grün; chat-cli nutzt die Factory; Duplikat-Dateien weg.

## Definition of Done
- Beide Slices grün im Gate.
- chat + chat-cli funktional unverändert, aber ohne die Boilerplate-Kopien.
- Geteilte Libs haben Tests für die neue Oberfläche.
- Follow-up dokumentiert: tasks/plans/timetrack (externe Repos) auf die neuen Lib-Versionen migrieren (braucht npm-Publish + per-Repo-PR).
