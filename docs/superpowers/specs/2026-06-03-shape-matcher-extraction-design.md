# Shape-Matcher-Extraktion — Design

**Datum:** 2026-06-03
**Status:** Freigegeben (Design)
**Kontext:** Phase-2-Konsolidierung, Top-Duplikat aus dem Survey.

## Problem

`packages/grants/src/server-resolver.ts` (300 LOC) und `packages/apes/src/shapes/parser.ts` (227 LOC) implementieren denselben argv→Shape-Operation→canonical-permission-Resolver. Die ~150 Zeilen argv-Matching-Hilfsfunktionen sind in beiden **praktisch identisch** (`parseOptionArgs`, `matchOperation`, `parseResourceChain`, `renderTemplate`, `resolveBindingToken`, `expandCombinedFlags`, `tryMatch`) — parametrisiert nur über denselben Operation-Feldsatz. Jeder Bugfix/jede Erweiterung muss zweimal gepflegt werden.

Die **echten** Unterschiede sind nur die I/O-Hüllen:

| | server-resolver (grants) | parser (apes) |
|---|---|---|
| Input | `ServerShape` aus `ShapeStore` | `LoadedAdapter` (TOML) |
| Executable-Check | lenient (Client hat verifiziert) | erzwingt Match |
| Kein-Match | generischer `synthetic`-Fallback | wirft Error |
| Output | `ServerResolvedCommand` | `ResolvedCommand` |
| adapter_version | `'server'` | Adapter-Version |

## Entscheidung

Den geteilten Matching-Kern in **`@openape/grants`** extrahieren (nicht neues Paket, nicht Modell-Vereinheitlichung). Begründung: grants beheimatet bereits `canonicalizeCliPermission`/`computeArgvHash` (die der Matcher nutzt) und den ServerShape-Resolver; apes hängt bereits von grants ab. Minimale neue Oberfläche, kein neues Paket / Publish-Rewiring, das Duplikat verschwindet sofort. Später leicht zu einem eigenen `@openape/shapes`-Paket beförderbar, falls eine schärfere Grenze gewünscht ist.

## Architektur

**Neues Modul `packages/grants/src/shape-matcher.ts`:**
- `export interface ShapeMatchOperation` — minimaler Feldsatz, den der Matcher liest: `id: string`, `command: string[]`, `required_options?: string[]`, `positionals?: string[]`, `resource_chain: string[]`, `action: string`, `display: string`, `risk: ScopeRiskLevel`, `exact_command?: boolean`. Sowohl apes' `ShapesOperation` als auch grants' `ServerShapeOperation` sind strukturell darauf zuweisbar.
- `export function matchArgvToOperation<T extends ShapeMatchOperation>(operations: T[], commandArgv: string[]): { operation: T, bindings: Record<string, string> } | null` — der pure Matcher: Pass 1 exakt, Pass 2 mit expandierten Combined-Flags, Most-Specific-Tie-Break (längster command-Prefix), `null` bei keinem Match. Kapselt die heute doppelten Helper als modul-private Funktionen.
- `export function buildCliAuthDetail(op: ShapeMatchOperation, bindings: Record<string, string>): OpenApeCliAuthorizationDetail` — baut das Detail (resource_chain rendern, display-Template, risk, exact_command-constraint) und setzt `permission` via `canonicalizeCliPermission`.

**Konsumenten (nur noch dünne Hüllen):**
- `grants/server-resolver.ts`: Helper-Kopien entfernen → `matchArgvToOperation` + `buildCliAuthDetail` importieren (modul-intern). Behält: ServerShape-Lookup, lenientes Executable, `buildGenericResolvedServer`-Fallback bei `null`, `ServerResolvedCommand`-Output (inkl. `synthetic`, `executionContext` mit `adapter_version:'server'`/`shape.digest`).
- `apes/shapes/parser.ts`: Helper-Kopien entfernen → `matchArgvToOperation` + `buildCliAuthDetail` aus `@openape/grants` importieren. Behält: Executable-Check (`executable !== loaded.adapter.cli.executable` → throw), throw bei `null`, `ResolvedCommand`-Output (inkl. `adapter`/`source`/`digest`, Adapter-Version).

## Datenfluss

`fullArgv` → Hülle trennt `executable` + `commandArgv` → `matchArgvToOperation(operations, commandArgv)` → bei Match: `buildCliAuthDetail(op, bindings)` + Hülle ergänzt executionContext/Output-Shape → bei `null`: Hülle entscheidet (server: generic synthetic; apes: throw).

## Fehlerbehandlung

Unverändert: Die internen Helper werfen bei malformed bindings/selectors; `tryMatch` fängt das pro Operation ab (eine kaputte Operation disqualifiziert nur sich selbst). `matchArgvToOperation` gibt `null` bei keinem Match — die Hülle entscheidet die Konsequenz (Fallback vs throw), exakt wie heute.

## Tests

- **Neu:** `packages/grants/src/__tests__/shape-matcher.test.ts` — fokussierte Unit-Tests: Long/Short-Option-Parsing (`--k=v`, `--k v`, `-k v`, boolean), Positional-Bindings + `=literal`-Constraints, Resource-Chain-Selektoren + Template-Transforms (`{x|owner}`), Combined-Flag-Expansion (`-rl`→`-r -l`), Most-Specific-Tie-Break, `required_options`-Enforcement, No-Match→`null`, `buildCliAuthDetail` setzt korrekte `permission`.
- **Regression:** bestehende `server-resolver`- und `parser`-Tests bleiben unverändert grün = Verhaltensbeweis (die Hüllen produzieren identischen Output wie vorher).

## Release

`@openape/grants` minor-Changeset (neuer Export `shape-matcher`). `apes` konsumiert via `workspace:*` — kein Publish nötig fürs Monorepo. Republish von grants + apes wird mit dem nächsten Release gebatcht (siehe Phase-2-Backlog: core-Republish steht ohnehin aus).

## Nicht im Scope

- Vereinheitlichung der Daten-Modelle (`ServerShape` vs `LoadedAdapter`) — bewusst verworfen, über das Dedup-Ziel hinaus.
- Neues `@openape/shapes`-Paket — später möglich, jetzt unnötige Zeremonie.
- Änderung des Resolver-Verhaltens (Fallback-/Throw-Semantik bleibt pro Seite).
