# `@openape/shapes` Extraction — Design

**Datum:** 2026-06-03
**Status:** Freigegeben (Design, Variante A)
**Kontext:** Phase-2-Decompose des apes-Monolithen, erstes Teilprojekt.

## Ziel

Den puren Shapes-Library-Kern (~1.7k LOC) aus `packages/apes/src/shapes/` in ein neues, eigenständiges Paket `@openape/shapes` extrahieren. apes schrumpft, die Grenze wird erzwungen, das früher gelöschte `packages/shapes`-Zombie wird endlich ein echtes Paket.

## Scope-Kontext

apes ist ~6 Subsysteme in einem Paket (shapes, agent-runtime, coding, agent-lifecycle, CLI-commands, shell). Dieser Spec deckt **nur** das erste Teilprojekt ab: shapes. Die übrigen folgen je eigenem Spec→Plan (siehe `docs/superpowers/plans/2026-06-03-phase2-backlog-handoff.md`).

## Grenze (Variante A — grants-Orchestrierung + CLI bleiben in apes)

**Wandert nach `@openape/shapes`** (pur: nur `@openape/core` + `@openape/grants` + node-builtins, kein Rück-Import in apes):
`adapters.ts`, `audit.ts`, `capabilities.ts`, `config.ts`, `generic.ts`, `http.ts`, `installer.ts`, `parser.ts`, `registry.ts`, `request-builders.ts`, `shell-parser.ts`, `toml.ts`, `types.ts` + ein neuer Paket-`index.ts` (exportiert nur die puren Funktionen) + die zugehörigen `__tests__`/`*.test.ts`.

**Bleibt in apes** (Glue-Schicht, an IdP/Config/Audit/CLI gebunden):
- `src/shapes/grants.ts` — Grant-Orchestrierung (`createShapesGrant`, `fetchGrantToken`, `verifyAndExecute`, `waitForGrantStatus`, `findExistingGrant`, `resolveFromGrant`, `verifyAndConsume`, `executeResolvedViaExec`). Importiert apes' `config.js` (`getIdpUrl`, Audit-Pfad) + `audit/generic-log.js`. Importiert künftig den Kern aus `@openape/shapes`.
- `src/shapes/commands/` — die `apes shapes …` CLI-Subcommands.
- `src/shapes/cli.ts` — citty-CLI-Entry (`runMain`), importiert commands/ + grants.ts.

**Verifiziert:** kein pures Modul importiert `grants.ts`/`commands/`/`cli.ts` — nur diese drei (+ der alte index-Re-Export) tun es. Grenze ist schnittfest.

## Architektur

- **Neues Paket** `packages/shapes/` (`@openape/shapes`), `package.json`/`tsconfig.json`/`tsup.config.ts`/`vitest.config.ts` gespiegelt von einem Geschwister (z.B. `packages/grants`). Deps: `@openape/core`, `@openape/grants` (workspace). publishable (`private` nicht gesetzt). In `pnpm-workspace.yaml` ist `packages/*` bereits geglobt.
- **Matcher bleibt in `@openape/grants`** (unverändert); `@openape/shapes/parser.ts` importiert `matchArgvToOperation`/`buildCliAuthDetail` weiterhin aus `@openape/grants`. `shapes → grants → core`, azyklisch.
- **Paket-`index.ts`** exportiert die puren Funktionen + Typen (Liste unten). NICHT die grants.ts-Funktionen und NICHT `extractOption`/`extractWrappedCommand` (die aus `commands/explain.ts` kommen und in apes bleiben).
- **apes** fügt `@openape/shapes` als dependency hinzu. `src/shapes/grants.ts`, `commands/`, `cli.ts` importieren den Kern aus `@openape/shapes` statt relativ. Die ~10 apes-Konsumenten (`index.ts`, `shell/*`, `commands/run|explain|proxy|grants|mcp`) importieren pure Shapes aus `@openape/shapes`.
- **apes `src/index.ts`** (Library-Surface) re-exportiert: pure Funktionen aus `@openape/shapes` **+** die in apes verbliebenen `grants.ts`-Funktionen + `extractOption`/`extractWrappedCommand`. Die öffentliche apes-Library-Oberfläche bleibt damit unverändert.

### Export-Split (aus heutigem apes/index.ts)
- **→ `@openape/shapes`:** `appendAuditLog`, `buildExactCommandGrantRequest`, `buildStructuredCliGrantRequest`, `extractShellCommandString`, `fetchRegistry`, `findAdapter`, `findConflictingAdapters`, `getInstalledDigest`, `installAdapter`, `isInstalled`, `loadAdapter`, `loadOrInstallAdapter`, `parseShellCommand`, `removeAdapter`, `resolveAdapterPath`, `resolveCapabilityRequest`, `resolveCommand`, `searchAdapters`, `tryLoadAdapter` + Typen `AdapterMeta`, `BuiltGrantRequest`, `GrantRequestOptions`, `LoadedAdapter`, `RegistryEntry`, `RegistryIndex`, `ResolvedCapability`, `ResolvedCommand`, `ShapesAdapter`, `ShapesOperation`.
- **bleibt in apes:** `createShapesGrant`, `fetchGrantToken`, `findExistingGrant`, `verifyAndExecute`, `waitForGrantStatus`, `extractOption`, `extractWrappedCommand`.

## Datenfluss / Fehlerbehandlung

Unverändert — reiner Move + Import-Rewiring. Keine Logikänderung in den bewegten Modulen.

## Tests

- Die zu den bewegten Modulen gehörenden Tests wandern mit ins Paket (`packages/shapes`). Sie müssen dort **unverändert grün** laufen (Verhaltensbeweis).
- In apes verbleibende Tests (für grants.ts/commands/) bleiben grün, nun gegen `@openape/shapes` importierend.
- Full gate (`pnpm lint && pnpm typecheck && pnpm test`) grün.

## Release

Neues `@openape/shapes` (initial, z.B. `0.1.0`) + `@openape/apes` minor (konsumiert es). `@openape/grants` unverändert. Changeset entsprechend; Publish gebatcht (lokaler `pnpm release`).

## Nicht im Scope

- Die übrigen apes-Subsysteme (agent-runtime, coding, lifecycle, commands, shell) — eigene Teilprojekte.
- Verlagerung des Matchers aus grants nach shapes (bewusst nicht — vermeidet Zyklus, grants ist die untere Schicht).
- Auflösen etwaiger Duplikation zwischen `shapes/config.ts` und apes' Top-Level `config.ts` (separat; hier nur Move).
