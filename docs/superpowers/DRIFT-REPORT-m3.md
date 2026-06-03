# M3 Drift-Report — Spec vs. Implementierung

Stand: 2026-06-03. Erzeugt aus der Conformance-Suite `@openape/protocol-conformance`
(Ajv-Validierung real emittierter Artefakte gegen die `protocol`-JSON-Schemas).
Jeder Punkt ist als `it.fails(...)` im Test kodiert → Gate bleibt grün, und sobald
die Richtung entschieden + umgesetzt ist, flippt der Test zur echten Assertion.

Status: **6 echte Assertions grün, 5 dokumentierte Drifts.**

## A) Sichere Catch-ups — Spec/Schema hinkt der gelieferten Realität hinterher
Empfehlung: Spec (`openape-ai/protocol`) + vendored Schema ergänzen, damit die Doku
das beschreibt, was längst in Prod läuft. Keine Code-Änderung, kein Bruch.

1. **`standing` GrantCategory** — `GrantCategory` enthält `standing` (vollständiges,
   getestetes Prod-Feature), aber `grant.json` enum ist nur `command|delegation`.
   → `standing` in `grants.md` §3.2 + `grant.json` enum aufnehmen.
2. **`scope`-Claim im AuthZ-JWT** — `issueAuthzJWT` schreibt `scope: string[]`;
   `authz-jwt-claims.json` hat `additionalProperties:false` ohne `scope`.
   → `scope` (OPTIONAL string[]) in Schema + `grants.md` §6.1 ergänzen.
3. **`delegate`-Claim im AuthZ-JWT** — wird bei Delegation gesetzt, fehlt im Schema.
   → `delegate` in Schema + `delegation.md` dokumentieren.
4. **`ssh-key` Auth-Methode** — Discovery emittiert `ddisa_auth_methods_supported:
   ['ed25519','ssh-key']`; Schema/Spec erlauben nur `webauthn|ed25519`.
   → `ssh-key` in `openid-configuration-extensions.json` + `core.md` §3.2 ergänzen.

## B) Echte Entscheidungen — Code und Spec widersprechen sich fundamental
Hier muss eine Seite gewinnen; beides zu lassen bricht externe Konsumenten. **Braucht deine Entscheidung.**

5. **Discovery-Endpoint-Feldnamen** — Code (`packages/server/.../discovery.ts`)
   emittiert `ddisa_auth_challenge_endpoint` / `ddisa_auth_authenticate_endpoint`,
   die Spec (`core.md` §3.2) definiert `ddisa_agent_challenge_endpoint` /
   `ddisa_agent_authenticate_endpoint`. Das Nuxt-Modul emittiert BEIDE Varianten;
   der CLI-Client (`packages/apes/src/http.ts`) sucht `ddisa_agent_*` und fällt mit
   einem dokumentierten Known-Bug-Kommentar auf Defaults zurück.
   - **Option A (empfohlen): `ddisa_auth_*` wird kanonisch.** Spec + Schema + CLI-Client
     auf `auth` umstellen; der Doppel-Emit im Modul kann perspektivisch auf `auth` reduziert
     werden (mit `// REMOVE-AFTER` für den `agent`-Alias).
   - **Option B: `ddisa_agent_*` bleibt kanonisch (Spec gewinnt).** `server`-Discovery auf
     `agent` umstellen; Risiko für bereits gegen `auth` integrierte SPs.
   - Hinweis: noch NICHT in der Conformance-Suite abgedeckt (Test rekonstruiert Discovery
     minimal) — wird nach Entscheidung mit dem realen Handler-Output erweitert.

6. **`openape.json`-Manifest: Record vs. Array** — Code (`OpenApeManifest.scopes`) ist
   `Record<string, OpenApeScope>` (Map), Spec (`sp-data-access.md` §3) + Schema
   (`sp-scope-catalog.json`) definieren ein Array `[{id, description, grants[]}]`.
   Strukturell inkompatibel — ein SP, der der Spec folgt, baut etwas, das der Code ablehnt.
   - **Option A (empfohlen): Record wird kanonisch.** Spec + Schema auf das Map-Format
     umstellen (`{[id]: {name, description, risk, category, parameters}}`). Code bleibt,
     keine Migration deployter SPs nötig.
   - **Option B: Array wird kanonisch.** Code-Parser + alle SP-`openape.json` auf Array
     umstellen — größerer Eingriff, betrifft jeden deployten SP.

## Nächste Schritte
- **A1–A4**: auf dein „ok" setze ich Schema- (vendored + upstream `protocol`-PR) und
  Spec-Ergänzungen um und flippe die jeweiligen `it.fails` → echte Assertions.
- **B5, B6**: ich brauche deine Wahl (Option A/B je). Danach Umsetzung in Code+Spec+Schema
  + Conformance-Erweiterung.
