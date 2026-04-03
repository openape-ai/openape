# Plan: @openape/server — Programmatischer IdP + SP

> Dieser Plan muss **self-contained** sein: Ein Agent oder Mensch ohne Vorwissen muss ihn
> von oben nach unten lesen und ein funktionierendes Ergebnis produzieren können.

## Purpose / Big Picture

- **Ziel:** Ein neues Package `@openape/server` das einen voll funktionalen DDISA IdP und SP als h3-App bereitstellt. Testbar ohne Nuxt, ohne Browser, mit In-Memory-Stores. `nuxt-auth-idp` wird duenner Wrapper. E2E-Tests laufen gegen `createIdPApp()` + `createSPApp()` in <1s.
- **Kontext:** Aktuell lebt die gesamte IdP-Logik (Routes, Stores, Handler) in `nuxt-auth-idp`. Das macht E2E-Tests langsam (Nuxt Dev-Server Startup), koppelt die Logik an Nuxt, und verhindert framework-agnostische Nutzung.
- **Scope:**
  - DRIN: Store-Interfaces nach `@openape/auth` verschieben, User/Agent vereinheitlichen, `@openape/server` Package, `createIdPApp()`, `createSPApp()`, In-Memory-Stores, E2E-Tests gegen programmatischen Server, `nuxt-auth-idp` als Wrapper
  - NICHT DRIN: Express-Middleware, WebAuthn-Integration in `@openape/server`, Free-IdP User-Limit, Self-Registration mit Email-Validation

## Architektur-Entscheidungen

### User und Agent Vereinheitlichung

Kein separater AgentStore mehr. Ein Agent ist ein User mit `owner` (enrolled von jemand anderem) und SSH-Key. Das User-Interface wird:

```typescript
interface User {
  email: string        // Primary ID
  name: string
  owner?: string       // Wer hat diesen User enrolled (undefined = self-registered)
  approver?: string    // Wer approved Grants (undefined = defaults to owner or self)
  isActive: boolean
  createdAt: number
}
```

Auth-Methoden (SSH-Keys, Passkeys) leben in separaten Stores die auf `userEmail` verweisen. Der `act`-Claim wird vom IdP bestimmt:
- User mit `owner` (enrolled von anderem User) -> `act: 'agent'`
- User ohne `owner` (`undefined`, self-registered) -> `act: 'human'`

### Store-Interfaces in @openape/auth

Die Store-Interfaces sind das Datenmodell des Protokolls und gehoeren in `@openape/auth` (framework-agnostic). `@openape/server` importiert sie und bietet In-Memory-Implementierungen.

### Legacy Agent-Endpoints

`/api/agent/*` Endpoints bleiben als Aliase in `nuxt-auth-idp`, nicht in `@openape/server`. Der neue Server bietet nur `/api/auth/*`.

### Package-Abhaengigkeiten

```
@openape/core                    (Types, DNS, JWT, PKCE -- keine Aenderung)
@openape/auth                    (+ Store-Interfaces: UserStore, SshKeyStore, ChallengeStore)
@openape/grants                  (+ Store-Interfaces: GrantStore -- bereits dort)
         |
@openape/server                  (NEU: h3 + createIdPApp + createSPApp + In-Memory-Stores)
         |
nuxt-auth-idp                    (Nuxt-Wrapper: importiert Handler aus @openape/server)
```

## Repo-Orientierung

- **Projekt:** OpenApe Monorepo, `/Users/patrickhofmann/Companies/private/repos/openape/openape-monorepo`
- **Neues Package:** `packages/server/`
- **Betroffene Packages:** `packages/auth/`, `modules/nuxt-auth-idp/`
- **Tech-Stack:** h3 (HTTP), jose (JWT), vitest (Tests)
- **Dev-Setup:**
  ```bash
  pnpm turbo run build    # Build all
  pnpm turbo run typecheck  # Typecheck all
  pnpm lint                 # Lint all
  pnpm turbo run test       # Test all
  ```

## Milestones

### Milestone 1: Store-Interfaces nach @openape/auth verschieben

**Ziel:** Alle Store-Interfaces die der IdP braucht leben in `@openape/auth`. Unified User-Interface statt User+Agent getrennt.

**Schritte:**

1. **Neues Interface** in `packages/auth/src/idp/stores.ts` (existiert bereits, erweitern):
   - Unified `User` Interface (email, name, owner?, approver?, isActive, createdAt)
   - `UserStore` Interface (create, findByEmail, list, update, delete, findByOwner)
   - `SshKey` Interface (keyId, userEmail, publicKey, name, createdAt)
   - `SshKeyStore` Interface (save, findById, findByUser, findByPublicKey, delete, deleteAllForUser)
   - `ChallengeStore` Interface (createChallenge, consumeChallenge)
   - In-Memory-Implementierungen: `InMemoryUserStore`, `InMemorySshKeyStore`, `InMemoryChallengeStore`

2. **Export** aus `packages/auth/src/idp/index.ts` und `packages/auth/src/index.ts`

3. **`nuxt-auth-idp` anpassen:** Store-Interfaces aus `@openape/auth` importieren statt lokal definieren. `AgentStore` wird Compat-Layer der das neue `UserStore` Interface wrapat.

**Akzeptanzkriterien:**
- [ ] `pnpm turbo run typecheck` -> 0 Fehler
- [ ] `pnpm turbo run test --filter=@openape/auth` -> alle Tests gruen
- [ ] `pnpm turbo run test --filter=@openape/nuxt-auth-idp` -> alle Tests gruen

**Rollback:** `git reset --hard HEAD~1`

---

### Milestone 2: @openape/server Package erstellen

**Ziel:** Neues Package `packages/server` mit h3-Dependency. `createIdPApp(config)` gibt eine h3-App zurueck mit allen IdP-Endpoints.

**Schritte:**

1. **Package scaffolding:** `packages/server/` mit package.json, tsconfig, tsup, vitest.config
2. **IdP Config Interface:** `IdPConfig` mit issuer, stores (optional, defaults to In-Memory), adminEmails, managementToken
3. **Handler-Muster:** Jeder Handler bekommt stores + config injected, gibt h3 `EventHandler` zurueck
4. **`createIdPApp(config)`:** Erstellt h3 App mit Router, registriert alle Handler
5. **`createSPApp(config)`:** Analog fuer SP
6. **Monorepo-Integration:** workspace, turbo.json

**Akzeptanzkriterien:**
- [ ] `pnpm turbo run build --filter=@openape/server` -> erfolgreich
- [ ] `pnpm turbo run typecheck --filter=@openape/server` -> 0 Fehler
- [ ] `createIdPApp({ issuer: 'http://localhost:3000' })` kompiliert

**Rollback:** `rm -rf packages/server`

---

### Milestone 3: IdP-Handler implementieren und testen

**Ziel:** Alle IdP-Endpoints funktionieren gegen In-Memory-Stores. 100% Test-Coverage.

**Schritte:**

1. **Handler-Logik** aus `nuxt-auth-idp/src/runtime/server/api/` extrahieren. Nuxt-spezifisches entfernen:
   - `useIdpStores()` -> `stores` Parameter
   - `useRuntimeConfig()` -> `config` Parameter
   - `getAppSession()` -> nicht noetig (Bearer-Token-only)
   - `createProblemError()` -> h3 `createError()` mit RFC 7807 Body

2. **Endpoints:**
   - POST /api/auth/challenge
   - POST /api/auth/authenticate
   - POST /api/auth/enroll (admin enrollt User mit SSH-Key)
   - GET /authorize (OIDC)
   - POST /token (OIDC)
   - GET /.well-known/jwks.json
   - GET /.well-known/openid-configuration
   - POST/GET /api/grants (CRUD)
   - POST /api/grants/:id/approve, deny, revoke, token, consume
   - POST /api/grants/batch
   - GET/POST/DELETE /api/delegations
   - POST/GET/DELETE /api/admin/users/:email/ssh-keys

3. **Test-Szenarien:**
   - User Enrollment (admin enrollt User mit SSH-Key)
   - Challenge-Response Login (ed25519)
   - OIDC Authorize Flow (Bearer Token -> Code)
   - Token Exchange (Code -> Assertion JWT)
   - Grant Request -> Approve -> Token -> Consume
   - Delegation erstellen und verwenden
   - JWKS und OpenID Configuration
   - Error Cases: ungueltiger Key, expired Challenge, doppeltes Enrollment

**Akzeptanzkriterien:**
- [ ] `pnpm turbo run test --filter=@openape/server` -> alle Tests gruen
- [ ] Coverage: 100% Statements/Functions/Lines
- [ ] Voller Lifecycle: Enroll -> Login -> Authorize -> Token -> Grant -> Execute

**Rollback:** `git reset --hard HEAD~1`

---

### Milestone 4: SP-Handler implementieren und testen

**Ziel:** `createSPApp()` funktioniert und kann gegen den IdP getestet werden.

**Schritte:**

1. **SP-Handler:** login (discover + authURL), callback (handleCallback), me (claims), metadata
2. **Session-Handling:** In-Memory Map fuer PKCE State zwischen login und callback
3. **Integration-Test:** IdP + SP zusammen in einem Test

**Akzeptanzkriterien:**
- [ ] Full OIDC flow: SP login -> IdP authorize -> SP callback -> claims
- [ ] Tests gruen, Coverage 100%

**Rollback:** `git reset --hard HEAD~1`

---

### Milestone 5: nuxt-auth-idp als Wrapper umbauen

**Ziel:** `nuxt-auth-idp` importiert Handler aus `@openape/server` statt eigene zu definieren.

**Schritte:**

1. **Handler ersetzen:** Jeder defineEventHandler delegiert an @openape/server Handler
2. **AgentStore Compat-Layer:** Adapter mappt AgentStore auf UserStore Interface
3. **Legacy /api/agent/* Endpoints** bleiben als Aliase
4. **Schrittweise Migration:** Pro Block (auth, grants, admin) migrieren und testen

**Akzeptanzkriterien:**
- [ ] `pnpm turbo run test --filter=@openape/nuxt-auth-idp` -> alle Tests gruen
- [ ] `pnpm turbo run test --filter=openape-free-idp` -> alle Tests gruen (Shapes E2E)
- [ ] Free-IdP deployt und funktioniert
- [ ] `/api/agent/*` Endpoints funktionieren weiterhin

**Rollback:** `git reset --hard HEAD~1`

---

### Milestone 6: E2E-Tests gegen programmatischen Server

**Ziel:** E2E-Tests laufen gegen `createIdPApp()` + `createSPApp()` statt Nuxt Dev-Server. Server-Startup <1s.

**Schritte:**

1. **server-manager.ts umschreiben:** `createIdPApp` + `createSPApp` + `createServer(toNodeHandler(app))`
2. **Bestehende Tests anpassen** falls Response-Formate sich geaendert haben
3. **apes-Tests hinzufuegen:** enroll -> login -> whoami -> run -> approve -> execute

**Akzeptanzkriterien:**
- [ ] `pnpm turbo run test --filter=openape-e2e` -> alle Tests gruen
- [ ] Server-Startup <1s
- [ ] Voller apes Lifecycle: enroll -> login -> whoami -> run -> approve -> execute

**Rollback:** `git reset --hard HEAD~1`

---

## Kritische Dateien

| Datei | Aktion | Milestone |
|-------|--------|-----------|
| `packages/auth/src/idp/stores.ts` | ERWEITERN | 1 |
| `packages/auth/src/idp/index.ts` | ERWEITERN | 1 |
| `modules/nuxt-auth-idp/src/runtime/server/utils/*.ts` | AENDERN | 1, 5 |
| `packages/server/` | NEU | 2 |
| `packages/server/src/idp/handlers/*.ts` | NEU | 3 |
| `packages/server/src/__tests__/*.ts` | NEU | 3, 4 |
| `packages/server/src/sp/handlers/*.ts` | NEU | 4 |
| `modules/nuxt-auth-idp/src/runtime/server/api/**/*.ts` | AENDERN | 5 |
| `examples/e2e/helpers/server-manager.ts` | UMSCHREIBEN | 6 |
| `examples/e2e/tests/*.ts` | ANPASSEN | 6 |

## Progress

- [ ] `[____-__-__ __:__]` Milestone 1: Store-Interfaces nach @openape/auth
- [ ] `[____-__-__ __:__]` Milestone 2: @openape/server Package Scaffolding
- [ ] `[____-__-__ __:__]` Milestone 3: IdP-Handler + Tests
- [ ] `[____-__-__ __:__]` Milestone 4: SP-Handler + Integration-Tests
- [ ] `[____-__-__ __:__]` Milestone 5: nuxt-auth-idp Wrapper-Umbau
- [ ] `[____-__-__ __:__]` Milestone 6: E2E gegen programmatischen Server

## Surprises & Discoveries

- (wird waehrend Implementierung befuellt)

## Decision Log

| Datum | Entscheidung | Begruendung | Alternativen verworfen |
|-------|-------------|------------|----------------------|
| 2026-04-03 | User + Agent vereinheitlichen | Agent = User mit owner. Reduziert Stores, vereinfacht Modell | Separate Stores behalten |
| 2026-04-03 | Store-Interfaces nach @openape/auth | Sind Protokoll-Datenmodell, nicht Server-spezifisch | In @openape/server |
| 2026-04-03 | Ein Package statt auth-h3 + grants-h3 | IdP braucht immer beides, Trennung erzeugt nur Import-Overhead | Getrennte h3-Packages |
| 2026-04-03 | Legacy /api/agent/* nur in nuxt-auth-idp | Rueckwaertskompatibilitaet ohne neuen Code zu belasten | Aliase in @openape/server |
| 2026-04-03 | User-Limit (10) nicht in @openape/server | Free-IdP Business-Logik, nicht Protokoll | In @openape/server als Config |
| 2026-04-03 | owner/approver am User belassen | Compliance-relevant, einfacher als separate Tabelle | Separate owner-Relation |

## Session-Checkliste

1. Plan lesen, Progress-Section pruefen
2. Git-Log seit letztem Commit lesen
3. `pnpm turbo run typecheck && pnpm turbo run test --filter='!docs'` -- Baseline
4. Naechsten offenen Milestone identifizieren
5. Implementieren, nach jedem Milestone committen
6. E2E-Verifikation der Akzeptanzkriterien
7. Progress-Section und Discoveries aktualisieren

## Outcomes & Retrospective

> Erst nach Abschluss aller Milestones ausfuellen.

- **Ergebnis:**
- **Abweichungen vom Plan:**
- **Learnings:**
