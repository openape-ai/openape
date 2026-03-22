# Feature: Drizzle-basierter GrantStore für free-idp

## Purpose

Der free-idp (`id.openape.at`) nutzt aktuell Unstorage mit dem db0/LibSQL-HTTP-Driver für Grants. Obwohl ein Batch-Read-Fix die N+1-Situation verbessert hat, bleibt jede Abfrage ein paralleler Schwarm von HTTP-Requests statt einer einzigen SQL-Query. Mit dem neuen `defineGrantStore()` Pattern (abgeschlossen 2026-03-21) kann die free-idp App jetzt einen eigenen Drizzle-basierten GrantStore registrieren, der echte SQL-Queries gegen Turso ausführt.

**Erwarteter Performance-Gewinn:** Eine `SELECT * FROM grants WHERE status = 'pending' ORDER BY created_at DESC LIMIT 20` Query statt ~50 paralleler `getItem()`-Calls. Bei 50 Grants: 1 HTTP-Roundtrip statt ~50.

---

## Progress

- [x] Milestone 1: Drizzle einrichten + Schema erstellen (2026-03-21)
- [x] Milestone 2: Drizzle GrantStore implementieren (2026-03-21)
- [x] Milestone 3: Drizzle GrantChallengeStore implementieren (2026-03-21)
- [x] Milestone 4: Store-Registrierung als Nitro-Plugin (2026-03-21)
- [x] Milestone 5: Toten Code aufräumen (2026-03-21, Lint-Fixes für antfu/consistent-chaining)
- [x] Milestone 6: Verifizierung + Build (2026-03-21, Tests 59/59, Lint 18/18, Build OK)

---

## Session Handoff — Getting Up to Speed

Falls dieser Plan in einer neuen Session fortgesetzt wird, starte mit diesen Schritten:

1. Lies diesen Plan von oben bis zur Progress-Section — dort steht welche Milestones erledigt sind.
2. Lies die zuletzt geänderten Dateien:

        git log --oneline -5 -- apps/openape-free-idp/

3. Verifiziere dass der aktuelle Stand baut:

        pnpm turbo run typecheck --filter=openape-free-idp

4. Arbeite am nächsten offenen Milestone weiter. Lies die zugehörigen Dateien bevor du Änderungen machst.

---

## Decision Log

| Datum | Entscheidung | Begründung |
|-------|-------------|------------|
| 2026-03-21 | Nur GrantStore + GrantChallengeStore migrieren | Erstmal Erfahrung sammeln, IdP-Stores kommen später |
| 2026-03-21 | Teilweise normalisiertes Schema | Filter-/Sort-Felder als Spalten mit Index, Rest als JSON — bester Kompromiss |
| 2026-03-21 | Bestehende Grants verwerfen | Keine Produktionsdaten die migriert werden müssen |
| 2026-03-21 | Gleiche Turso-DB, neue Tabelle | Kein separates DB-Setup nötig, `kv`-Tabelle für IdP-Daten bleibt |
| 2026-03-21 | CREATE TABLE IF NOT EXISTS im Plugin | Kein Drizzle-Kit/Migration-Tooling — eine Tabelle rechtfertigt das nicht |
| 2026-03-21 | Tote schema.ts löschen | Drizzle war nicht mal installiert, 4 Tabellen werden nirgends genutzt |
| 2026-03-21 | Bestehende E2E-Tests reichen | Custom-Store greift nur wenn registriert — E2E mit memoryDriver testen weiterhin die Default-Implementierung |

---

## Surprises & Discoveries

_(Wird während der Implementierung befüllt)_

---

## Context & Orientation

Die free-idp App hat folgende Storage-Architektur:

    server/plugins/storage.ts
      → storage.mount('idp', db0Driver)    ← bleibt (Credentials, Users, Tokens etc.)
      → storage.mount('grants', db0Driver) ← wird durch Drizzle-Store umgangen

    server/plugins/grant-store.ts (NEU)
      → defineGrantStore((event) => DrizzleGrantStore)
      → defineGrantChallengeStore((event) => DrizzleGrantChallengeStore)

Beide Mounts zeigen auf dieselbe Turso-DB. Der `grants`-Mount bleibt gemountet (Rückwärtskompatibilität), aber der Custom-Store umgeht Unstorage und spricht direkt mit Drizzle/LibSQL.

**Datenbank-Verbindung:** Die Turso-Credentials liegen in `nuxt.config.ts` unter `runtimeConfig.tursoUrl` und `runtimeConfig.tursoAuthToken`. Diese werden auch vom bestehenden db0-Driver in `storage.ts` genutzt. Der Drizzle-Client verwendet denselben Zugang.

---

## Referenz-Types (self-contained)

Das `OpenApeGrant`-Objekt (aus `packages/core/src/types/index.ts`) hat diese Struktur:

    interface OpenApeGrant {
      id: string                          // UUID
      type?: 'delegation'                 // null für normale Grants
      request: OpenApeGrantRequest        // Verschachteltes Objekt (→ JSON-Spalte)
      status: GrantStatus                 // 'pending' | 'approved' | 'denied' | 'revoked' | 'expired' | 'used'
      decided_by?: string                 // Email des Approvers
      created_at: number                  // Unix-Timestamp (Sekunden)
      decided_at?: number
      expires_at?: number
      used_at?: number
    }

    interface OpenApeGrantRequest {
      requester: string                   // Email oder 'agent:xxx'
      target_host: string
      audience: string
      grant_type?: 'once' | 'timed' | 'always'
      permissions?: string[]
      authorization_details?: OpenApeAuthorizationDetail[]
      command?: string[]
      cmd_hash?: string
      execution_context?: OpenApeExecutionContext
      duration?: number
      reason?: string
      run_as?: string
      delegator?: string                  // Nur bei Delegation-Grants
      delegate?: string                   // Nur bei Delegation-Grants
      scopes?: string[]
    }

Die `request`-Felder die wir als eigene DB-Spalten brauchen (für SQL-Filtering):
- `requester` — filtern nach Requester
- `target_host` — Grant-Reuse-Check
- `audience` — Grant-Reuse-Check
- `grant_type` — Logik-Unterscheidung

Die restlichen `request`-Felder werden als JSON gespeichert und nur beim Lesen deserialisiert.

**Konvertierung DB-Row ↔ Grant-Objekt:**

`rowToGrant(row)` rekonstruiert ein `OpenApeGrant` aus einer DB-Zeile. Die `request`-JSON-Spalte wird geparst und mit den Top-Level-Spalten (`requester`, `target_host`, `audience`, `grant_type`) zusammengeführt. Die Top-Level-Spalten haben Vorrang (sie sind die "source of truth" für indizierte Felder).

`grantToRow(grant)` extrahiert die indizierten Felder aus `grant.request` in eigene Spalten und serialisiert das gesamte `grant.request`-Objekt als JSON.

---

## Invarianten (DÜRFEN SICH NICHT ÄNDERN)

- Alle bestehenden Grant-API-Routen müssen identisch funktionieren (Request/Response unverändert)
- Der `idp`-Storage-Mount bleibt unangetastet (Credentials, Users, Tokens)
- Der `grants`-Storage-Mount bleibt gemountet (Rückwärtskompatibilität)
- Die Module-Tests (`@openape/nuxt-auth-idp`) müssen weiterhin grün sein
- E2E-Tests mit memoryDriver bleiben funktional

---

## Implementierung

### Milestone 1: Drizzle einrichten + Schema erstellen

**Ziel:** Drizzle ORM ist installiert, das Grants-Schema ist definiert, und die Tabelle wird beim App-Start automatisch erstellt.

**Schritt 1 — Dependency hinzufügen:**

    cd /Users/patrickhofmann/Companies/private/repos/openape/openape-monorepo
    pnpm add drizzle-orm --filter=openape-free-idp

`@libsql/client` ist bereits installiert (in package.json als `^0.14.0`).

**Schritt 2 — Schema erstellen.**

Die bestehende Datei `apps/openape-free-idp/server/database/schema.ts` enthält 4 tote Tabellen (magicLinkTokens, rateLimits, authCodes, signingKeys) die nirgends importiert werden. Diese Datei wird komplett ersetzt mit dem Grants-Schema:

Datei: `apps/openape-free-idp/server/database/schema.ts`

Die `grants`-Tabelle hat folgende Spalten:
- `id` (TEXT, Primary Key) — Grant-UUID
- `status` (TEXT, NOT NULL, Index) — für Filterung
- `type` (TEXT, nullable, Index) — 'delegation' oder NULL
- `requester` (TEXT, NOT NULL, Index) — für Filterung
- `target_host` (TEXT, NOT NULL) — für Grant-Reuse-Check
- `audience` (TEXT, NOT NULL) — für Grant-Reuse-Check
- `grant_type` (TEXT, NOT NULL) — 'once' | 'timed' | 'always'
- `request` (TEXT, JSON-Mode, NOT NULL) — vollständiges OpenApeGrantRequest-Objekt
- `created_at` (INTEGER, NOT NULL, Index) — für Sortierung
- `decided_at` (INTEGER, nullable)
- `decided_by` (TEXT, nullable)
- `expires_at` (INTEGER, nullable)
- `used_at` (INTEGER, nullable)

Die `grant_challenges`-Tabelle hat:
- `challenge` (TEXT, Primary Key) — 32-Byte Hex-String
- `agent_id` (TEXT, NOT NULL)
- `expires_at` (INTEGER, NOT NULL)

**Schritt 3 — Drizzle-Instanz erstellen.**

Neue Datei: `apps/openape-free-idp/server/database/drizzle.ts`

Erstellt einen LibSQL-Client mit `createClient({ url, authToken })` aus der RuntimeConfig und initialisiert Drizzle. Die Instanz wird als Singleton gecacht (gleiche DB-Verbindung für alle Requests).

**Schritt 4 — Tabellen-Erstellung als Nitro-Plugin.**

Neue Datei: `apps/openape-free-idp/server/plugins/02.database.ts`

Führt `CREATE TABLE IF NOT EXISTS` und `CREATE INDEX IF NOT EXISTS` für beide Tabellen aus. Überspringt die Erstellung wenn `OPENAPE_E2E === '1'` (E2E-Tests nutzen den memoryDriver-Default).

Das bestehende `storage.ts` wird zu `01.storage.ts` umbenannt (Reihenfolge: Storage → Database → Grant-Store).

**Idempotenz:** `CREATE TABLE IF NOT EXISTS` und `CREATE INDEX IF NOT EXISTS` sind sicher wiederholbar.

**Akzeptanzkriterium:**

    pnpm turbo run typecheck --filter=openape-free-idp

    Erwartete letzte Zeile:
    Tasks:    X successful, X total

**Git-Commit:**

    git add apps/openape-free-idp/
    git commit -m "feat(free-idp): add Drizzle grants schema and database plugin"

---

### Milestone 2: Drizzle GrantStore implementieren

**Ziel:** Ein vollständiger `ExtendedGrantStore` der echte SQL-Queries gegen die `grants`-Tabelle ausführt.

Neue Datei: `apps/openape-free-idp/server/utils/drizzle-grant-store.ts`

Exportiert eine Funktion `createDrizzleGrantStore()` die ein `ExtendedGrantStore`-Objekt zurückgibt. Alle 9 Methoden werden als SQL-Queries implementiert:

**save(grant):** `INSERT INTO grants ... ON CONFLICT(id) DO UPDATE SET ...` — Upsert, damit die Methode sowohl für neue als auch aktualisierte Grants funktioniert. Nutzt `grantToRow()` zur Konvertierung.

**findById(id):** `SELECT * FROM grants WHERE id = ?` — Einzelabfrage, nutzt `rowToGrant()` zur Rückkonvertierung.

**updateStatus(id, status, extra):** `UPDATE grants SET status = ?, ... WHERE id = ?` — Setzt Status und optionale Extra-Felder (decided_by, decided_at, expires_at, used_at). Wirft Error wenn der Grant nicht existiert (kein Row affected).

**findPending():** `SELECT * FROM grants WHERE status = 'pending' ORDER BY created_at DESC` — Nutzt den `idx_grants_status` Index.

**findByRequester(requester):** `SELECT * FROM grants WHERE requester = ? ORDER BY created_at DESC` — Nutzt den `idx_grants_requester` Index.

**findAll():** `SELECT * FROM grants ORDER BY created_at DESC` — Full-Table-Scan, aber nur 1 Query statt N.

**findByDelegate(delegate):** `SELECT * FROM grants WHERE type = 'delegation' AND requester IN (...)` — Hier gibt es eine Herausforderung: `delegate` steht im `request`-JSON. Lösung: `json_extract(request, '$.delegate') = ?` funktioniert in SQLite/LibSQL.

**findByDelegator(delegator):** Analog zu findByDelegate mit `json_extract(request, '$.delegator')`.

**listGrants(params):** Die komplexeste Methode. Baut dynamisch eine Query mit optionalen WHERE-Klauseln für `status` und `requester`, cursor-basierter Pagination (`created_at < cursorTs`), und LIMIT. Gibt `PaginatedResponse<OpenApeGrant>` zurück.

**Helper-Funktionen:**

`grantToRow(grant)` nimmt ein `OpenApeGrant` und gibt ein Objekt mit den DB-Spalten zurück. Extrahiert `requester`, `target_host`, `audience`, `grant_type` aus `grant.request` und serialisiert das gesamte `request`-Objekt als JSON-String.

`rowToGrant(row)` nimmt eine DB-Zeile und rekonstruiert ein `OpenApeGrant`. Parst die `request`-JSON-Spalte und überschreibt die duplizierten Felder mit den Werten aus den indexierten Spalten (diese sind die Source of Truth).

**Akzeptanzkriterium:**

    pnpm turbo run typecheck --filter=openape-free-idp

    Erwartete letzte Zeile:
    Tasks:    X successful, X total

**Git-Commit:**

    git add apps/openape-free-idp/server/utils/drizzle-grant-store.ts
    git commit -m "feat(free-idp): implement Drizzle-based ExtendedGrantStore"

---

### Milestone 3: Drizzle GrantChallengeStore implementieren

**Ziel:** Ein `ChallengeStore` der die `grant_challenges`-Tabelle nutzt.

Neue Datei: `apps/openape-free-idp/server/utils/drizzle-grant-challenge-store.ts`

Exportiert `createDrizzleGrantChallengeStore()` mit 2 Methoden:

**createChallenge(agentId):** Generiert einen 32-Byte Hex-Challenge-String (`randomBytes(32).toString('hex')`), speichert ihn mit `INSERT INTO grant_challenges` (TTL: 60 Sekunden als `expires_at = Date.now() + 60_000`). Gibt den Challenge-String zurück.

**consumeChallenge(challenge, agentId):** `SELECT * FROM grant_challenges WHERE challenge = ?`, dann `DELETE`. Prüft: (1) Existiert der Eintrag? (2) Stimmt die `agentId`? (3) Ist `expiresAt > Date.now()`? Gibt `true` zurück wenn alle drei Bedingungen erfüllt, sonst `false`.

**Akzeptanzkriterium:**

    pnpm turbo run typecheck --filter=openape-free-idp

    Erwartete letzte Zeile:
    Tasks:    X successful, X total

**Git-Commit:**

    git add apps/openape-free-idp/server/utils/drizzle-grant-challenge-store.ts
    git commit -m "feat(free-idp): implement Drizzle-based GrantChallengeStore"

---

### Milestone 4: Store-Registrierung als Nitro-Plugin

**Ziel:** Der Drizzle-Store wird beim App-Start via `defineGrantStore()` und `defineGrantChallengeStore()` registriert.

Neue Datei: `apps/openape-free-idp/server/plugins/03.grant-store.ts`

Importiert `defineGrantStore` und `defineGrantChallengeStore` aus `#imports`, und die `createDrizzle*` Funktionen aus den Utils. Registriert beide Stores. Überspringt die Registrierung wenn `OPENAPE_E2E === '1'` (E2E-Tests sollen den Default-Unstorage-Store nutzen).

**Plugin-Reihenfolge:** Nitro-Plugins laufen in alphabetischer Reihenfolge:
1. `01.storage.ts` — Unstorage-Mounts (idp + grants)
2. `02.database.ts` — CREATE TABLE IF NOT EXISTS
3. `03.grant-store.ts` — defineGrantStore Registry

Die Factories ignorieren das H3-Event (free-idp ist Single-Tenant), aber das Interface verlangt den Parameter.

**Akzeptanzkriterium:**

    pnpm turbo run typecheck --filter=openape-free-idp

    Erwartete letzte Zeile:
    Tasks:    X successful, X total

**Git-Commit:**

    git add apps/openape-free-idp/server/plugins/
    git commit -m "feat(free-idp): register Drizzle grant stores via defineGrantStore"

---

### Milestone 5: Toten Code aufräumen

**Ziel:** Die tote `schema.ts` wurde in Milestone 1 bereits ersetzt. Hier prüfen wir ob alles clean ist.

1. Prüfen ob `db0` noch als Dependency gebraucht wird: Ja — der `idp`-Mount in `01.storage.ts` nutzt den db0-Driver. `db0` bleibt.
2. Lint laufen lassen um ungenutzte Imports zu finden.

**Akzeptanzkriterium:**

    pnpm lint --filter=openape-free-idp

    Erwartung: keine Fehler

**Git-Commit** (falls Aufräumarbeiten nötig):

    git commit -m "chore(free-idp): clean up dead code"

---

### Milestone 6: Verifizierung + Build

**Ziel:** Full-Stack-Verifizierung mit user-sichtbarem Akzeptanzkriterium.

**Schritt 1 — Module-Tests (Regression):**

    pnpm turbo run test --filter=@openape/nuxt-auth-idp

    Erwartete Ausgabe:
    Test Files  12 passed (12)
         Tests  59 passed (59)

**Schritt 2 — Lint:**

    pnpm lint

    Erwartete letzte Zeile:
    Tasks:    18 successful, 18 total

**Schritt 3 — Typecheck:**

    pnpm typecheck

    Erwartete letzte Zeile:
    Tasks:    24 successful, 24 total

**Schritt 4 — Build:**

    pnpm turbo run build --filter=openape-free-idp

    Erwartete letzte Zeilen:
    ✨ Build complete!
    Tasks:    X successful, X total

**Schritt 5 — User-sichtbarer Akzeptanztest:**

    cd apps/openape-free-idp
    node .output/server/index.mjs

    Dann im Browser oder via curl:

    curl -s http://localhost:3000/api/grants | head -c 200

    Erwartete Antwort (leere Grants-Liste, da wir bei Null starten):
    {"data":[],"pagination":{"cursor":null,"has_more":false}}

    Die Antwort muss in <500ms kommen (statt der bisherigen mehreren Sekunden bei vielen Grants).

**Alle Schritte müssen erfolgreich sein.**

**Git-Commit** (finaler Zustand):

    git add .
    git commit -m "feat(free-idp): complete Drizzle grant store migration"

---

## Betroffene Dateien (vollständig)

### Neue Dateien
- `apps/openape-free-idp/server/database/drizzle.ts` — Drizzle-Instanz + LibSQL-Client
- `apps/openape-free-idp/server/utils/drizzle-grant-store.ts` — ExtendedGrantStore Implementierung
- `apps/openape-free-idp/server/utils/drizzle-grant-challenge-store.ts` — ChallengeStore Implementierung
- `apps/openape-free-idp/server/plugins/02.database.ts` — CREATE TABLE IF NOT EXISTS
- `apps/openape-free-idp/server/plugins/03.grant-store.ts` — defineGrantStore Registrierung

### Geänderte Dateien
- `apps/openape-free-idp/server/database/schema.ts` — Ersetzt (4 tote Tabellen → Grants + Challenges Schema)
- `apps/openape-free-idp/server/plugins/storage.ts` → Umbenannt zu `01.storage.ts` (Reihenfolge)
- `apps/openape-free-idp/package.json` — `drizzle-orm` als Dependency

### Unveränderte Dateien
- `apps/openape-free-idp/nuxt.config.ts`
- Alle Module-Dateien (`modules/nuxt-auth-idp/`)
- Alle Packages (`packages/`)
- `apps/service/`

---

## Idempotenz & Recovery

`CREATE TABLE IF NOT EXISTS` ist idempotent. Der `defineGrantStore`-Aufruf überschreibt die Registry. Git-Commits nach jedem Milestone dienen als Checkpoints. Bei Problemen: `git checkout -- apps/openape-free-idp/` revertiert alle App-Änderungen, der Default-Unstorage-Store greift dann automatisch wieder — die App funktioniert sofort ohne Custom-Store.

---

## Baseline-Verifizierung (vor Implementierungsbeginn)

    pnpm turbo run test --filter=@openape/nuxt-auth-idp
    pnpm turbo run typecheck --filter=openape-free-idp
    pnpm turbo run build --filter=openape-free-idp

Falls einer fehlschlägt: STOPP. Zuerst fixen.

---

## Outcomes & Retrospective

_(Wird nach Abschluss befüllt)_
