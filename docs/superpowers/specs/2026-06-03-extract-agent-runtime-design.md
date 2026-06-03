# `@openape/agent-runtime` Extraction — Design

**Datum:** 2026-06-03
**Status:** Freigegeben (Scope: ganzes Execution-Cluster)
**Kontext:** apes-Decompose, Teil 2.

## Ziel

Das Agent-Execution-Cluster (~2.2k LOC) aus `packages/apes/src/lib/` in ein eigenständiges `@openape/agent-runtime`-Paket extrahieren: der In-Process-Loop + die Tools + der Coding-Agent — sie sind wechselseitig verflochten und gehören logisch zusammen.

## Boundary (Recon-Befund)

**Wandert nach `@openape/agent-runtime`:**
- `src/lib/agent-runtime.ts` (300) — `runLoop`, `RpcSessionMap` + Typen (`ChatMessage`, `RunOptions`, `RunResult`, `RuntimeConfig`, `RunStreamHandlers`, `TraceEntry`).
- `src/lib/agent-tools/` (alle: `index`, `file`, `http`, `bash`, `mail`, `tasks`, `time`, `forge`, `verify`, `git-worktree`, `ape-shell-exec`) — `taskTools`, `TOOLS`, `ToolDefinition`, `runApeShell`, `ApeShellResult`, `asOpenAiTools` etc.
- `src/lib/coding/` (alle: `coding-loop`, `forge`, `merge-policy`, `derive-policy`, `llm-review`, `verify` …).
- die zugehörigen Tests: `agent-runtime.test.ts`, `agent-tools.test.ts`, `coding.test.ts` (+ etwaige co-located).

**Verifiziert (Recon):** das gesamte Cluster importiert nach außen **ausschließlich node-builtins** — kein apes-config/http/llm-bridge/secrets, **kein `@openape/*`, kein bare-npm**. Der LLM-Zugang läuft per **Dependency-Injection** (`RuntimeConfig` an `runLoop`), nicht per Import. Deshalb ist der Schnitt sauber.

**Paket-Deps:** node-builtins only (kein `@openape/*`, keine npm-Runtime-Deps). `private:false`.

## Architektur

- **Neues Paket** `packages/agent-runtime/` (`@openape/agent-runtime`), Config gespiegelt von `packages/grants` (tsup/vitest/tsconfig). Interne Struktur: `src/index.ts`, `src/agent-runtime.ts`, `src/agent-tools/`, `src/coding/` (per `git mv` aus apes).
- **`src/index.ts`** exportiert die öffentliche Cluster-Oberfläche: `runLoop`, `RpcSessionMap`, die agent-runtime-Typen, `taskTools`, `TOOLS`, `ToolDefinition`, `runApeShell`, `ApeShellResult`.
- **apes** fügt `@openape/agent-runtime` als dependency hinzu. Die ~5 Konsumenten (`src/index.ts`, `src/commands/agents/{run,serve,code}.ts`, `src/commands/nest/authorize.ts`) importieren das Cluster künftig aus `@openape/agent-runtime`.
- **apes `src/index.ts`** re-exportiert die Cluster-Oberfläche aus `@openape/agent-runtime` (Zeilen 51-63 heute) → **apes Library-Surface unverändert**, also bleibt der externe Konsument **`@openape/ape-agent`** (bridge.ts, thread-session.ts) **ohne Änderung** (er importiert `runLoop`/`TOOLS`/… weiterhin aus `@openape/apes`).

## Datenfluss / Fehlerbehandlung

Unverändert — reiner Move + Import-Rewiring + Re-Export. Keine Logikänderung. LLM/Secrets/Config werden wie bisher vom Consumer (commands/agents/serve, bridge) in `runLoop` injiziert.

## Tests

- `agent-runtime.test.ts`, `agent-tools.test.ts`, `coding.test.ts` (+ co-located) wandern mit ins Paket und laufen dort **byte-identisch grün** (Verhaltensbeweis).
- apes-Suite (Lifecycle/commands, die das Cluster nutzen) bleibt grün, nun gegen `@openape/agent-runtime`.
- Full gate grün.

## Release

Neues `@openape/agent-runtime` (initial `0.1.0`) + `@openape/apes` minor. Changeset; Publish gebatcht.

## Nicht im Scope

- llm-bridge, agent-secrets-runtime, agent-bootstrap, troop-client, host-platform, launchd-reconcile, macos-user — bleiben in apes (eigene Teilprojekte; v.a. der Mac-Teil verzahnt mit M2).
- Auftrennen der internen runtime↔tools↔coding-Kopplung — bewusst nicht; sie bleiben als ein Cluster zusammen.
