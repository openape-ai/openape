# Feature: defineStore Pattern für nuxt-auth-idp

## Purpose

Das `@openape/nuxt-auth-idp` Modul hat 11 Stores mit fest verdrahteten Unstorage-Implementierungen. Apps die das Modul konsumieren (free-idp mit Turso, Service-App mit S3) können aktuell keine eigenen, optimierten Storage-Backends einsetzen. Dieses Feature führt ein `defineXxxStore()` Pattern ein, über das jede App ihre eigene Store-Implementierung als Nitro-Plugin registrieren kann. Der Default bleibt die bestehende Unstorage-Implementierung — 100% rückwärtskompatibel, Minor Bump.

**Auslöser:** Grants laden auf `id.openape.at` langsam (N+1 Unstorage-Requests gegen Turso via LibSQL HTTP). Die Architektur verhindert app-spezifische Optimierungen, weil Storage im Modul verdrahtet ist. Ein Batch-Read-Fix wurde bereits umgesetzt, aber echte SQL-Queries (z.B. via Drizzle) wären um Größenordnungen schneller.

---

## Progress

- [x] Milestone 1: Store-Registry Infrastruktur (2026-03-21)
- [x] Milestone 2: Grant-Stores umstellen (2026-03-21)
- [x] Milestone 3: IdP-Stores umstellen (2026-03-21)
- [x] Milestone 4: Module-Export + Typ-Exports (2026-03-21, Auto-Imports via addServerImportsDir reichen)
- [x] Milestone 5: Verifizierung + Build (2026-03-21, Tests 59/59, Lint 18/18, Typecheck 24/24, Builds OK)
- [x] Milestone 6: Changeset (2026-03-21)

---

## Decision Log

| Datum | Entscheidung | Begründung |
|-------|-------------|------------|
| 2026-03-21 | Nitro-Plugin als Registrierung | Konsistent mit bestehendem `storage.ts` Plugin-Pattern in den Apps |
| 2026-03-21 | Factory bekommt H3-Event | Nötig für Multi-Tenancy (Service-App setzt per-Event Storage-Keys via Middleware) |
| 2026-03-21 | Alle 11 Stores austauschbar | Nicht nur Grants haben das N+1-Problem — alle Stores nutzen dasselbe Unstorage-Pattern |
| 2026-03-21 | ExtendedGrantStore als Pflicht | Module-interner Code nutzt `findAll`, `findByDelegate`, `findByDelegator` — optionale Methoden würden Fallback-Logik erfordern |
| 2026-03-21 | Challenge-Store separat | Grant-Challenges haben ein eigenes Interface (`createChallenge`/`consumeChallenge`), orthogonal zum GrantStore |
| 2026-03-21 | Minor Bump | Rein additiv, kein Breaking Change — Apps ohne Custom-Store ändern sich nicht |
| 2026-03-21 | Default im Modul | Auslagern in separates Package wäre Over-Engineering, Unstorage-Default soll immer mitgeliefert werden |

---

## Surprises & Discoveries

_(Wird während der Implementierung befüllt)_

---

## Context & Orientation

Das Modul `@openape/nuxt-auth-idp` stellt ein komplettes Identity Provider System bereit. Es wird von zwei Apps konsumiert:

**1. `apps/openape-free-idp`** — Single-Tenant IdP, deployed auf Vercel. Nutzt Turso (LibSQL HTTP) als Storage-Backend über Unstorage + db0-Driver. Die Storage-Mounts werden in `server/plugins/storage.ts` konfiguriert.

**2. `apps/service`** — Multi-Tenant SaaS, deployed auf Vercel. Nutzt S3 als Storage-Backend. Per-Tenant-Isolation passiert über dynamische Storage-Mounts in Middleware (`server/middleware/02.tenant-context.ts`), die `event.context.openapeStorageKey` und `event.context.openapeGrantsStorageKey` setzen.

Die Store-Architektur hat drei Schichten:

```
API-Route-Handler (z.B. /api/grants/index.get.ts)
    ↓ ruft auf
useGrantStores() / useIdpStores() (grant-stores.ts / stores.ts)
    ↓ erstellt
createXxxStore() (z.B. grant-store.ts, user-store.ts)
    ↓ nutzt
useGrantStorage() / useIdpStorage() (grant-storage.ts / storage.ts)
    ↓ delegiert an
Unstorage (gemountet via Nitro-Plugin)
```

Dieses Feature fügt eine Registry-Schicht zwischen Schicht 2 und 3 ein: `useGrantStores()` prüft zuerst ob eine Custom-Factory registriert ist, und fällt nur dann auf `createXxxStore()` (Unstorage) zurück.

---

## Invarianten (DÜRFEN SICH NICHT ÄNDERN)

- Alle bestehenden API-Routen müssen identisch funktionieren (Request/Response-Format unverändert)
- Apps ohne Custom-Store müssen ohne jede Code-Änderung weiter funktionieren
- Multi-Tenancy in der Service-App (per-Event Storage-Keys via Middleware) muss weiter funktionieren
- Bestehende Tests müssen grün bleiben ohne Anpassung
- `@openape/grants` Package Interface bleibt unverändert
- `@openape/auth` Package Interfaces bleiben unverändert
- DDISA-Protokoll-Compliance bleibt gewahrt

---

## Store-Inventar (11 Stores, 2 Gruppen)

### Gruppe A: IdP-Stores (in `stores.ts`, Mount: `idp:`)

| # | Store | Interface | Methoden | Definiert in |
|---|-------|-----------|----------|-------------|
| 1 | UserStore | `UserStore` | `create`, `findByEmail`, `listUsers`, `deleteUser` | Lokal |
| 2 | CodeStore | `CodeStore` | `save`, `find`, `delete` | `@openape/auth` |
| 3 | KeyStore | `KeyStore` | `getSigningKey`, `getAllPublicKeys` | `@openape/auth` |
| 4 | AgentStore | `AgentStore` | `create`, `findById`, `findByEmail`, `update`, `delete`, `listAll`, `findByOwner`, `findByApprover` | Lokal |
| 5 | CredentialStore | `CredentialStore` | `save`, `findById`, `findByUser`, `delete`, `deleteAllForUser`, `updateCounter` | `@openape/auth` |
| 6 | ChallengeStore | `ChallengeStore` | `save`, `find`, `consume` | `@openape/auth` |
| 7 | RegistrationUrlStore | `RegistrationUrlStore` | `save`, `find`, `consume`, `list`, `delete` | `@openape/auth` |
| 8 | JtiStore | `JtiStore` | `hasBeenUsed`, `markUsed` | `@openape/auth` |
| 9 | RefreshTokenStore | `RefreshTokenStore` | `create`, `consume`, `revokeByToken`, `revokeFamily`, `revokeByUser`, `listFamilies` | `@openape/auth` |

### Gruppe B: Grant-Stores (in `grant-stores.ts`, Mount: `grants:`)

| # | Store | Interface | Methoden | Definiert in |
|---|-------|-----------|----------|-------------|
| 10 | GrantStore | `ExtendedGrantStore` | `save`, `findById`, `updateStatus`, `findPending`, `findByRequester`, `findAll`, `findByDelegate`, `findByDelegator`, `listGrants` | `@openape/grants` + Lokal |
| 11 | GrantChallengeStore | `GrantChallengeStore` | `createChallenge`, `consumeChallenge` | Lokal |

---

## Implementierung

### Milestone 1: Store-Registry Infrastruktur

**Ziel:** Ein zentraler Registry-Mechanismus für Custom-Store-Factories existiert und ist typsicher.

**Neue Datei: `modules/nuxt-auth-idp/src/runtime/server/utils/store-registry.ts`**

Enthält eine module-level `Map<string, StoreFactory>` mit zwei Funktionen: `registerStoreFactory(name, factory)` zum Registrieren und `getStoreFactory(name)` zum Abfragen. Die Factory ist typisiert als `(event: H3Event) => T` — das Event wird durchgereicht damit die Factory tenant-aware Storage nutzen kann.

**Neue Datei: `modules/nuxt-auth-idp/src/runtime/server/utils/define-stores.ts`**

Exportiert 11 typisierte Convenience-Funktionen — eine pro Store. Jede Funktion ist ein dünner Wrapper um `registerStoreFactory` mit dem korrekten Store-Namen und TypeScript-Generics:

- `defineGrantStore(factory: (event: H3Event) => ExtendedGrantStore)`
- `defineGrantChallengeStore(factory: (event: H3Event) => GrantChallengeStore)`
- `defineUserStore(factory: (event: H3Event) => UserStore)`
- `defineCodeStore(factory: (event: H3Event) => CodeStore)`
- `defineKeyStore(factory: (event: H3Event) => KeyStore)`
- `defineAgentStore(factory: (event: H3Event) => AgentStore)`
- `defineCredentialStore(factory: (event: H3Event) => CredentialStore)`
- `defineChallengeStore(factory: (event: H3Event) => ChallengeStore)`
- `defineRegistrationUrlStore(factory: (event: H3Event) => RegistrationUrlStore)`
- `defineJtiStore(factory: (event: H3Event) => JtiStore)`
- `defineRefreshTokenStore(factory: (event: H3Event) => RefreshTokenStore)`

Diese Funktionen werden via `addServerImportsDir` als Nitro-Auto-Imports verfügbar (das Directory ist bereits registriert in `module.ts`).

**Idempotenz:** Beide Dateien sind rein additiv. Erneutes Ausführen dieses Milestones überschreibt einfach die Dateien.

**Akzeptanzkriterium:**

    cd /Users/patrickhofmann/Companies/private/repos/openape/openape-monorepo
    pnpm turbo run typecheck --filter=@openape/nuxt-auth-idp

    Erwartete Ausgabe (letzte Zeile):
    Tasks:    4 successful, 4 total

---

### Milestone 2: Grant-Stores umstellen

**Ziel:** `useGrantStores()` prüft die Registry, fällt auf Unstorage-Default zurück. Ohne registrierten Custom-Store verhält sich alles identisch wie vorher.

**Datei ändern: `modules/nuxt-auth-idp/src/runtime/server/utils/grant-stores.ts`**

Die `useGrantStores()` Funktion wird erweitert. Der aktuelle Flow ist:

    useGrantStores()
      → event.context vorhanden? → per-Event Cache oder initStores()
      → kein Event? → globaler Singleton

Der neue Flow wird:

    useGrantStores()
      → event holen
      → per-Event Cache vorhanden? → zurückgeben
      → Registry hat Factory für 'grantStore'? → Factory(event) aufrufen
      → Registry hat Factory für 'grantChallengeStore'? → Factory(event) aufrufen
      → Sonst: Default createGrantStore() / createGrantChallengeStore()
      → Ergebnis in event.context._grantStores cachen

Wichtig: Wenn nur einer der beiden Stores (grant oder challenge) custom registriert ist, wird der andere weiterhin als Default erstellt. Kein alles-oder-nichts.

**Tests bleiben unverändert** — ohne registrierten Custom-Store greift der Default.

**Akzeptanzkriterien:**

    pnpm turbo run test --filter=@openape/nuxt-auth-idp
    # Erwartung: alle Tests grün

    pnpm turbo run typecheck --filter=@openape/nuxt-auth-idp
    # Erwartung: Tasks: 4 successful, 4 total

---

### Milestone 3: IdP-Stores umstellen

**Ziel:** `useIdpStores()` prüft die Registry für jeden der 9 IdP-Stores individuell.

**Datei ändern: `modules/nuxt-auth-idp/src/runtime/server/utils/stores.ts`**

Gleiches Pattern wie Milestone 2, aber für 9 Stores. Die `initStores()` Funktion wird ergänzt: für jeden Store prüft sie ob eine Custom-Factory registriert ist. Falls ja, wird `factory(event)` aufgerufen, falls nein der Default `createXxxStore()`.

Herausforderung: `initStores()` hat aktuell keinen Zugriff auf das Event. Lösung: Die Store-Erstellung wird in `useIdpStores()` verlagert, wo das Event verfügbar ist. `initStores()` bleibt als Default-Fallback für den Fall ohne Event (globaler Singleton).

Jeder Store ist einzeln überschreibbar — eine App kann z.B. nur den `userStore` und `agentStore` custom implementieren, während alle anderen weiterhin Unstorage nutzen.

**Akzeptanzkriterien:**

    pnpm turbo run test --filter=@openape/nuxt-auth-idp
    pnpm turbo run typecheck --filter=@openape/nuxt-auth-idp
    # Beides muss erfolgreich sein

---

### Milestone 4: Module-Export + Typ-Exports

**Ziel:** App-Entwickler können `defineXxxStore` und alle Store-Interfaces importieren.

**Prüfen:** Die `define-stores.ts` Datei liegt in `runtime/server/utils/` — dieses Directory ist bereits via `addServerImportsDir(resolve('./runtime/server/utils'))` in `module.ts` (Zeile 102) registriert. Die `defineXxxStore` Funktionen sollten damit als Auto-Imports im Nitro-Kontext verfügbar sein (Import via `#imports` in Server-Plugins).

**Falls nötig:** Explizite Re-Exports in einer `modules/nuxt-auth-idp/src/runtime/server/index.ts` Datei für den Fall dass Apps explizit importieren wollen:

    import { defineGrantStore } from '@openape/nuxt-auth-idp/runtime/server'

Typ-Exports prüfen: Alle Store-Interfaces (`ExtendedGrantStore`, `UserStore`, `AgentStore`, etc.) müssen für App-Entwickler importierbar sein, damit sie typsichere Implementierungen schreiben können.

**Akzeptanzkriterium:**

    pnpm turbo run typecheck --filter=@openape/nuxt-auth-idp
    # Muss erfolgreich sein

---

### Milestone 5: Verifizierung + Build

**Ziel:** Full-Stack-Verifizierung — alle Tests, Lint, Typecheck und Builds für beide konsumierenden Apps.

**Befehle (in dieser Reihenfolge):**

    # 1. Tests
    pnpm turbo run test --filter=@openape/nuxt-auth-idp
    # Erwartung: alle Tests grün

    # 2. Lint
    pnpm lint
    # Erwartung: Tasks: 18 successful (oder ähnlich), keine Fehler

    # 3. Typecheck gesamt
    pnpm typecheck
    # Erwartung: alle Packages erfolgreich

    # 4. Build free-idp (Single-Tenant Regression)
    pnpm turbo run build --filter=openape-free-idp
    # Erwartung: "Build complete!" am Ende

    # 5. Build service (Multi-Tenancy Regression)
    pnpm turbo run build --filter=@openape/cloud
    # Erwartung: "Build complete!" am Ende

**Alle 5 Befehle müssen erfolgreich sein.** Falls einer fehlschlägt: den Fehler fixen, bevor zum nächsten Milestone übergegangen wird.

---

### Milestone 6: Changeset

**Ziel:** Changeset für Minor Bump erstellt.

**Befehl:**

    pnpm changeset

**Auswahl:**
- Package: `@openape/nuxt-auth-idp`
- Bump: `minor`
- Beschreibung: `feat: add defineXxxStore pattern for custom storage backends`

Nicht publishen — das passiert via GitHub Actions Release-Workflow.

---

## Betroffene Dateien (vollständig)

### Neue Dateien
- `modules/nuxt-auth-idp/src/runtime/server/utils/store-registry.ts`
- `modules/nuxt-auth-idp/src/runtime/server/utils/define-stores.ts`
- `modules/nuxt-auth-idp/src/runtime/server/index.ts` (nur falls nötig für explizite Imports)

### Geänderte Dateien
- `modules/nuxt-auth-idp/src/runtime/server/utils/stores.ts` — Registry-Lookup einfügen
- `modules/nuxt-auth-idp/src/runtime/server/utils/grant-stores.ts` — Registry-Lookup einfügen

### Unveränderte Dateien
- Alle `create*Store.ts` Dateien (Default-Implementierungen bleiben exakt wie sie sind)
- Alle API-Route-Handler (nutzen `useGrantStores()` / `useIdpStores()` — deren Interface ändert sich nicht)
- Alle Pages
- `modules/nuxt-auth-idp/src/module.ts` (Auto-Import-Dir ist bereits registriert)
- `packages/grants/` (Interface unverändert)
- `packages/auth/` (Interfaces unverändert)
- `apps/openape-free-idp/` (keine Änderungen nötig für Rückwärtskompatibilität)
- `apps/service/` (keine Änderungen nötig)

---

## Nutzung durch Apps (Beispiel nach Implementierung)

So würde eine App einen Custom-Store als Nitro-Plugin registrieren:

    // apps/openape-free-idp/server/plugins/custom-grant-store.ts
    import { defineGrantStore } from '#imports'
    import { db } from '../database/drizzle'
    import { grants } from '../database/schema'

    defineGrantStore((event) => ({
      async save(grant) {
        await db.insert(grants).values(grant).onConflictDoUpdate(...)
      },
      async findById(id) {
        return await db.select().from(grants).where(eq(grants.id, id)).get() ?? null
      },
      async listGrants(params) {
        // 1 SQL-Query statt N+1 Unstorage-Requests
        return await db.select().from(grants)
          .where(and(
            params?.status ? eq(grants.status, params.status) : undefined,
            params?.requester ? eq(grants.requester, params.requester) : undefined,
          ))
          .orderBy(desc(grants.createdAt))
          .limit(params?.limit ?? 20)
      },
      // ... alle weiteren Methoden des ExtendedGrantStore Interface
    }))

---

## Idempotenz & Recovery

Alle Milestones sind idempotent — sie können wiederholt ausgeführt werden ohne Seiteneffekte. Neue Dateien werden überschrieben, geänderte Dateien ersetzen die gleichen Code-Blöcke. Git-Commits nach jedem Milestone dienen als Checkpoints. Bei Problemen: `git diff` zeigt was sich geändert hat, `git checkout -- <file>` revertiert einzelne Dateien.

---

## Baseline-Verifizierung (vor Implementierungsbeginn)

Vor dem ersten Code-Change diese Befehle ausführen:

    pnpm turbo run test --filter=@openape/nuxt-auth-idp
    pnpm turbo run typecheck --filter=@openape/nuxt-auth-idp
    pnpm turbo run build --filter=openape-free-idp

Falls einer fehlschlägt: STOPP. Zuerst den Baseline-Fehler fixen, bevor mit dem Feature begonnen wird.

---

## Outcomes & Retrospective

_(Wird nach Abschluss befüllt: Was hat funktioniert? Was war unerwartet? Was würden wir anders machen?)_
