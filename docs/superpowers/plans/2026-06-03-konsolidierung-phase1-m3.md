# OpenApe Konsolidierung — Phase 1, M3 (Spec-Contract-Tests) Plan

**Goal:** Drift zwischen Implementierung und Protokoll-Spec wird ein automatisierter Test. Das materialisiert das Leitprinzip „Spec-Driven, Contract-Enforced".

**Architecture:** Neues privates Package `packages/protocol-conformance`. Es vendored die JSON-Schemas aus dem Schwester-Repo `openape-ai/protocol` (mit Provenance-Header + `scripts/sync-protocol-schemas.mjs`, der aus `../../../protocol/schemas` re-kopiert wenn vorhanden) und validiert mit Ajv die real emittierten Artefakte (Discovery-Doc, AuthZ-JWT-Payload, Grant-Objekt, `openape.json`-Manifest) gegen die Schemas. **Bekannte Drift wird mit `it.fails` ehrlich katalogisiert** → Gate bleibt grün, jeder Eintrag ist sichtbar und flippt zur echten Assertion sobald Code-oder-Spec angeglichen wurde.

**Tech Stack:** Vitest, Ajv (neue devDep), TypeScript, pnpm/turbo workspace.

**Entscheidung (Schema-Bezug):** Schemas werden vendored (committet) statt submodule/published-package. Reversibel; falls später ein publishtes `@openape/protocol-schemas` gewünscht ist, leicht umstellbar. Begründung: protocol ist (noch) kein npm-Package, ein relativer Pfad zum Schwester-Checkout wäre in frischen Clones fragil.

## Bekannte Drift (aus Survey) — pro Item Richtung
| Drift | Sichere Catch-up-Richtung | Oder echte Protokoll-Entscheidung |
|---|---|---|
| `ddisa_auth_*` (Code) vs `ddisa_agent_*` (Spec) Discovery-Felder | — | **Entscheidung:** welcher Name kanonisch? (Nuxt-Modul emittiert beide) |
| `standing` GrantCategory undokumentiert (in Prod) | Spec+Schema ergänzen | — |
| `scope` (singular) im AuthZ-JWT fehlt in Spec/Schema | Spec+Schema ergänzen | — |
| `approver`-Claim undokumentiert | Spec+Schema ergänzen | — |
| `ssh-key` Auth-Methode fehlt in Spec/Schema | Spec+Schema ergänzen | — |
| `openape.json` Array (Spec/Schema) vs Record (Code) | — | **Entscheidung:** Array oder Record als kanonisches Format? |

Spec-Updates leben im Repo `openape-ai/protocol` (separater PR). Schema-Updates im vendored Mirror + upstream.

## Tasks (subagent-getrieben, Gate nach jedem)
- **M3.1** Package-Gerüst: `packages/protocol-conformance/package.json` (private), ajv devDep, vendored `schemas/*.json` (Header: „Mirror of openape-ai/protocol@<sha-or-date> — DO NOT edit, run sync"), `scripts/sync-protocol-schemas.mjs`.
- **M3.2** Conformance-Tests: pro Artefakt das real emittierte Objekt beschaffen (bevorzugt pure Funktionen: `issueAuthzJWT`+decode, `validateOpenApeManifest`/Type-Sample, Discovery-Handler mit Minimal-Config) und gegen das passende Schema validieren. Currently-passing = echte Assertion; bekannte Drift = `it.fails(...)` mit Kommentar + Verweis auf Drift-Report.
- **M3.3** Drift-Report `docs/superpowers/DRIFT-REPORT-m3.md`: jeder rote Punkt, Richtung, „safe catch-up" vs „braucht User-Entscheidung".

## Definition of Done
- `pnpm test` grün (inkl. neuer Conformance-Suite; Drift via `it.fails` dokumentiert, nicht rot).
- Ein absichtlich falsch gemachtes Discovery-Feld lässt eine echte (nicht-`fails`) Conformance-Assertion rot werden.
- Drift-Report committet; Protokoll-Entscheidungen an User eskaliert.
