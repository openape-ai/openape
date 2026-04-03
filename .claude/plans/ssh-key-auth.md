# Plan: SSH Key Authentication für Menschen

> Dieser Plan muss **self-contained** sein: Ein Agent oder Mensch ohne Vorwissen muss ihn
> von oben nach unten lesen und ein funktionierendes Ergebnis produzieren können.
> Keine externen Referenzen, kein implizites Wissen. Alles Relevante steht hier.

## Purpose / Big Picture

- **Ziel:** Menschen können sich am IdP mit ed25519 SSH-Keys via Challenge-Response authentifizieren (wie Agents), erhalten einen JWT mit `act: 'human'`. E2E-Tests nutzen diesen Flow statt dem fragilen `POST /api/login` (der gar nicht als richtiger Endpoint existiert).
- **Kontext:** WebAuthn-only Login erfordert Playwright + WebAuthn-Mocking für Tests — komplex, langsam, fehleranfällig. SSH-Key Auth ermöglicht headless, browser-freie E2E-Tests.
- **Scope:**
  - DRIN: SshKeyStore, generalisiertes Token-System, Unified Auth Endpoints (`/api/auth/*`), Admin Key Management, Free-IdP Drizzle Store, OIDC Discovery, E2E Test Umbau
  - NICHT DRIN: Self-Registration mit Email-Validierung (separates Follow-Up-Issue)

## Architekturprinzip: IdP entscheidet `act`

Der `act`-Claim wird **nie** vom Key oder Client bestimmt. Der Unified Authenticate-Endpoint prüft:
1. Ist die `id` ein Agent im `AgentStore`? → `act: 'agent'`
2. Ist die `id` ein User im `UserStore` mit SSH-Key im `SshKeyStore`? → `act: 'human'`

Bestehender Code bestätigt dieses Muster:
- `packages/auth/src/idp/token.ts:148`: `act: claims.delegation_act ?? claims.act ?? 'human'` — Default ist `'human'`
- `packages/core/src/types/index.ts:43`: `type ActorType = 'human' | 'agent'` — bereits definiert

## DDISA-Protokoll-Kompatibilität

- Bestehende `/api/agent/*` Endpoints bleiben als volle Endpunkte erhalten → Rückwärtskompatibilität
- Neue `/api/auth/*` Endpoints sind eine Obermenge mit identischem Challenge-Response-Protokoll
- `act`-Claim unterscheidet klar zwischen `'agent'` und `'human'`
- OpenApe-Erweiterung über die DDISA-Spec hinaus — kein Konflikt, da Agent-Endpoints unverändert

## Repo-Orientierung

- **Projekt:** OpenApe Monorepo, `/Users/patrickhofmann/Companies/private/repos/openape/openape-monorepo`
- **Relevante Module:**
  - `modules/nuxt-auth-idp/src/runtime/server/` — Alle Server-seitigen IdP Utils und API Routes
  - `apps/openape-free-idp/server/` — Drizzle DB Schema und Store-Implementierungen
  - `examples/e2e/` — E2E Tests
- **Tech-Stack:** Nuxt 4, h3, jose (JWT), Node.js crypto (ed25519), Drizzle ORM, Vitest
- **Dev-Setup:**
  ```bash
  pnpm turbo run build --filter=@openape/nuxt-auth-idp  # Build Modul
  pnpm turbo run typecheck                               # Typecheck all
  pnpm lint                                               # Lint all
  pnpm turbo run test --filter=openape-free-idp          # Unit Tests
  pnpm turbo run test --filter=openape-e2e               # E2E Tests
  ```

## Wiederverwendete Infrastruktur (unverändert)

| Utility | Pfad | Zweck |
|---------|------|-------|
| `verifyEd25519Signature()` | `modules/nuxt-auth-idp/src/runtime/server/utils/ed25519.ts` | Signatur-Verifikation |
| `sshEd25519ToKeyObject()` | selbe Datei | SSH-Key → KeyObject |
| `challengeStore` | `modules/nuxt-auth-idp/src/runtime/server/utils/grant-challenge-store.ts` | Challenge Create/Consume (32 bytes hex, 60s TTL) |
| `keyStore.getSigningKey()` | via `useIdpStores()` | JWT-Signierung |
| `registerStoreFactory()` | `modules/nuxt-auth-idp/src/runtime/server/utils/store-registry.ts` | Store-Factory-Registry |
| `createProblemError()` | `modules/nuxt-auth-idp/src/runtime/server/utils/problem.ts` | RFC 7807 Fehler |
| `requireAdmin()` | `modules/nuxt-auth-idp/src/runtime/server/utils/admin.ts` | Admin Auth Guard |

## Milestones

### Milestone 1: SSH Key Store (Modul-Ebene)

**Ziel:** SshKeyStore-Interface und Default-Implementierung (unstorage) im Modul. Registrierbar via `defineSshKeyStore()`.

**Schritte:**

1. **Neue Datei** `modules/nuxt-auth-idp/src/runtime/server/utils/ssh-key-store.ts`:
   ```typescript
   export interface SshKey {
     keyId: string         // SHA256-Fingerprint des Public Keys
     userEmail: string     // Zugeordneter User
     publicKey: string     // Volle ssh-ed25519 Zeile
     name: string          // Label, z.B. "work laptop"
     createdAt: number     // Unix timestamp
   }

   export interface SshKeyStore {
     save(key: SshKey): Promise<void>
     findById(keyId: string): Promise<SshKey | null>
     findByUser(email: string): Promise<SshKey[]>
     findByPublicKey(publicKey: string): Promise<SshKey | null>
     delete(keyId: string): Promise<void>
     deleteAllForUser(email: string): Promise<void>
   }
   ```
   Default-Implementierung mit unstorage: `ssh-keys:{keyId}` + Index `user-ssh-keys:{email}` (analog zu `credential-store.ts`).
   `findByPublicKey()`: iteriert über alle Keys (kein performanter Reverse-Index nötig bei wenigen Keys pro User). Für Free-IdP Drizzle-Impl wird ein DB-Index genutzt (Milestone 5).

2. **Ändern** `modules/nuxt-auth-idp/src/runtime/server/utils/stores.ts`:
   - `sshKeyStore: SshKeyStore` zum `IdpStores` Interface hinzufügen
   - In `initDefaultStores()` einbinden: `sshKeyStore: createSshKeyStore()`
   - In `initStoresWithRegistry()` einbinden: `sshKeyStore: getStoreFactory<SshKeyStore>('sshKeyStore')?.(event) ?? createSshKeyStore()`

3. **Ändern** `modules/nuxt-auth-idp/src/runtime/server/utils/define-stores.ts`:
   - Neue `defineSshKeyStore()` Funktion (analog zu `defineAgentStore()`)

**Akzeptanzkriterien:**
- [ ] `pnpm turbo run typecheck --filter=@openape/nuxt-auth-idp` → 0 Fehler
- [ ] `pnpm turbo run build --filter=@openape/nuxt-auth-idp` → erfolgreich

**Rollback:** `git reset --hard HEAD~1`

---

### Milestone 2: Generalisiertes Token-System

**Ziel:** `issueAuthToken()` und `verifyAuthToken()` die sowohl `act: 'agent'` als auch `act: 'human'` unterstützen. Bestehende Agent-Funktionen werden zu Wrappern.

**Schritte:**

1. **Erweitern** `modules/nuxt-auth-idp/src/runtime/server/utils/agent-token.ts`:
   ```typescript
   // NEU — generalisiert
   export interface AuthTokenPayload {
     sub: string
     act: ActorType  // 'agent' | 'human'
   }

   export async function issueAuthToken(
     payload: { sub: string, act: ActorType },
     issuer: string,
     privateKey: KeyLike,
     kid?: string,
   ): Promise<string> {
     // Gleiche Logik wie issueAgentToken, aber mit variablem act
   }

   export async function verifyAuthToken(
     token: string,
     issuer: string,
     publicKey: KeyLike | Uint8Array,
   ): Promise<AuthTokenPayload> {
     // Verifiziert JWT, akzeptiert act: 'agent' ODER 'human'
   }

   // BESTEHEND — werden zu Wrappern
   export async function issueAgentToken(...) {
     return issueAuthToken({ sub: payload.sub, act: 'agent' }, issuer, privateKey, kid)
   }
   export async function verifyAgentToken(...) {
     const result = await verifyAuthToken(token, issuer, publicKey)
     if (result.act !== 'agent') throw new Error('Not an agent token')
     return result as AgentTokenPayload
   }
   ```
   Import `ActorType` aus `@openape/core`.

2. **Erweitern** `modules/nuxt-auth-idp/src/runtime/server/utils/agent-auth.ts`:
   ```typescript
   // NEU — akzeptiert beide act-Typen
   export async function tryBearerAuth(event: H3Event): Promise<AuthTokenPayload | null> {
     // Gleiche Logik wie tryAgentAuth, aber verifyAuthToken statt verifyAgentToken
   }

   // BESTEHEND — bleibt als Wrapper
   export async function tryAgentAuth(event: H3Event): Promise<AgentTokenPayload | null> {
     const result = await tryBearerAuth(event)
     if (!result || result.act !== 'agent') return null
     return result as AgentTokenPayload
   }
   ```

3. **Ändern** `modules/nuxt-auth-idp/src/runtime/server/routes/authorize.get.ts`:
   - `tryAgentAuth()` → `tryBearerAuth()`
   - Wenn `result.act === 'human'`: `actorType` NICHT auf `'agent'` setzen — IdP behandelt es wie normalen Human-Login
   - Wenn `result.act === 'agent'`: wie bisher `actorType = 'agent'`

**Akzeptanzkriterien:**
- [ ] `pnpm turbo run typecheck --filter=@openape/nuxt-auth-idp` → 0 Fehler
- [ ] Bestehende Agent-Auth Tests passen weiterhin (da Wrapper identisch funktionieren)
- [ ] `pnpm turbo run test --filter=openape-free-idp` → alle Tests grün

**Rollback:** `git reset --hard HEAD~1`

---

### Milestone 3: Unified Auth Endpoints

**Ziel:** `/api/auth/challenge` und `/api/auth/authenticate` die sowohl Agents als auch Humans mit SSH-Keys bedienen.

**Schritte:**

1. **Neue Datei** `modules/nuxt-auth-idp/src/runtime/server/api/auth/challenge.post.ts`:
   ```
   POST /api/auth/challenge
   Body: { id: string }   // Email oder Agent-UUID
   ```
   Ablauf:
   1. Lookup in `AgentStore` (by email oder ID) → wenn aktiv, Challenge erstellen mit `challengeStore.createChallenge(agent.id)`
   2. Falls nicht: Lookup in `SshKeyStore` (by `findByUser(id)` → mindestens 1 Key?) → Challenge erstellen mit `challengeStore.createChallenge(email)`
   3. Falls weder noch: 404 Fehler
   4. Response: `{ challenge: string }`

2. **Neue Datei** `modules/nuxt-auth-idp/src/runtime/server/api/auth/authenticate.post.ts`:
   ```
   POST /api/auth/authenticate
   Body: { id: string, challenge: string, signature: string, public_key?: string }
   ```
   Ablauf:
   1. Lookup in `AgentStore` → falls gefunden und aktiv:
      - Challenge konsumieren mit `challengeStore.consumeChallenge(challenge, agent.id)`
      - Signatur gegen `agent.publicKey` verifizieren
      - JWT: `issueAuthToken({ sub: agent.email, act: 'agent' }, ...)`
   2. Falls nicht: Lookup in `SshKeyStore`:
      - `public_key` angegeben? → `findByPublicKey()` für Identifikation
      - Sonst: `findByUser(id)` → wenn genau 1 Key, diesen verwenden; bei >1 Keys: Fehler "public_key required"
      - Challenge konsumieren mit `challengeStore.consumeChallenge(challenge, email)`
      - Signatur verifizieren
      - User aus `UserStore` holen → muss existieren
      - JWT: `issueAuthToken({ sub: user.email, act: 'human' }, ...)`
   3. Response: `{ token, id, email, name, act, expires_in }`

3. **Bestehende Agent-Endpoints unverändert lassen:**
   - `/api/agent/challenge` → bleibt wie es ist (nur AgentStore)
   - `/api/agent/authenticate` → bleibt wie es ist (nur AgentStore, `act: 'agent'`)

4. **Ändern** `modules/nuxt-auth-idp/src/module.ts`:
   - Im `routeConfig.agent` Block die neuen Routes registrieren:
     ```typescript
     addServerHandler({ route: '/api/auth/challenge', method: 'post', handler: resolve('./runtime/server/api/auth/challenge.post') })
     addServerHandler({ route: '/api/auth/authenticate', method: 'post', handler: resolve('./runtime/server/api/auth/authenticate.post') })
     ```
   - CORS-Rule: `corsRules['/api/auth/**'] = { cors: true }` hinzufügen

**Akzeptanzkriterien:**
- [ ] `pnpm turbo run build --filter=@openape/nuxt-auth-idp` → erfolgreich
- [ ] `pnpm turbo run typecheck` → 0 Fehler
- [ ] Bestehende Agent-Auth funktioniert unverändert (E2E shapes-e2e.test.ts grün)

**Rollback:** `git reset --hard HEAD~1`

---

### Milestone 4: Admin Key Management

**Ziel:** Admins können SSH-Keys für Users registrieren, auflisten und löschen. User-Löschung bereinigt SSH-Keys.

**Schritte:**

1. **Neue Datei** `modules/nuxt-auth-idp/src/runtime/server/api/admin/users/[email]/ssh-keys.post.ts`:
   - Auth: `requireAdmin(event)`
   - Body: `{ publicKey: string, name?: string }`
   - Validiert `ssh-ed25519` Format via `sshEd25519ToKeyObject()` (wirft bei ungültigem Key)
   - Extrahiert Comment als Fallback-Name
   - Berechnet `keyId` als SHA256-Fingerprint des Raw Public Keys
   - Prüft ob User existiert — falls nicht: User via `userStore.createUser({ email, name: name || email })` anlegen
   - Prüft Duplikat-Keys via `sshKeyStore.findByPublicKey()`
   - Speichert in SshKeyStore
   - Response: `{ keyId, userEmail, publicKey, name, createdAt }`

2. **Neue Datei** `modules/nuxt-auth-idp/src/runtime/server/api/admin/users/[email]/ssh-keys.get.ts`:
   - Auth: `requireAdmin(event)`
   - Liefert `sshKeyStore.findByUser(email)`

3. **Neue Datei** `modules/nuxt-auth-idp/src/runtime/server/api/admin/users/[email]/ssh-keys/[keyId].delete.ts`:
   - Auth: `requireAdmin(event)`
   - `sshKeyStore.delete(keyId)`

4. **Ändern** `modules/nuxt-auth-idp/src/runtime/server/api/admin/users/[email].delete.ts`:
   - Nach `userStore.deleteUser(decoded)` auch `sshKeyStore.deleteAllForUser(decoded)` aufrufen
   - `sshKeyStore` via `useIdpStores()` holen

5. **Ändern** `modules/nuxt-auth-idp/src/module.ts`:
   - Im `routeConfig.admin` Block registrieren:
     ```typescript
     addServerHandler({ route: '/api/admin/users/:email/ssh-keys', handler: resolve('./runtime/server/api/admin/users/[email]/ssh-keys.get') })
     addServerHandler({ route: '/api/admin/users/:email/ssh-keys', method: 'post', handler: resolve('./runtime/server/api/admin/users/[email]/ssh-keys.post') })
     addServerHandler({ route: '/api/admin/users/:email/ssh-keys/:keyId', method: 'delete', handler: resolve('./runtime/server/api/admin/users/[email]/ssh-keys/[keyId].delete') })
     ```

**Akzeptanzkriterien:**
- [ ] `pnpm turbo run build --filter=@openape/nuxt-auth-idp` → erfolgreich
- [ ] `pnpm turbo run typecheck` → 0 Fehler
- [ ] `pnpm lint` → clean

**Rollback:** `git reset --hard HEAD~1`

---

### Milestone 5: Free-IdP Drizzle Store + OIDC Discovery

**Ziel:** Drizzle-basierter SshKeyStore für Free-IdP (SQLite) + OIDC Discovery aktualisiert.

**Schritte:**

1. **Ändern** `apps/openape-free-idp/server/database/schema.ts`:
   ```typescript
   export const sshKeys = sqliteTable('ssh_keys', {
     keyId: text('key_id').primaryKey(),
     userEmail: text('user_email').notNull(),
     publicKey: text('public_key').notNull(),
     name: text('name').notNull(),
     createdAt: integer('created_at').notNull(),
   }, table => [
     index('idx_ssh_keys_user_email').on(table.userEmail),
     index('idx_ssh_keys_public_key').on(table.publicKey),
   ])
   ```

2. **Neue Datei** `apps/openape-free-idp/server/utils/drizzle-ssh-key-store.ts`:
   - Implementiert `SshKeyStore` Interface mit Drizzle Queries
   - `findByPublicKey()` nutzt DB-Index statt Iteration

3. **Ändern** `apps/openape-free-idp/server/plugins/04.idp-stores.ts`:
   - `defineSshKeyStore(() => createDrizzleSshKeyStore())` hinzufügen

4. **DB-Migration generieren:**
   ```bash
   cd apps/openape-free-idp && npx drizzle-kit generate
   ```

5. **Ändern** `modules/nuxt-auth-idp/src/runtime/server/routes/well-known/openid-configuration.get.ts`:
   - Bestehende Endpoints beibehalten
   - Neue Endpoints hinzufügen:
     ```typescript
     ddisa_auth_challenge_endpoint: `${issuer}/api/auth/challenge`,
     ddisa_auth_authenticate_endpoint: `${issuer}/api/auth/authenticate`,
     ```
   - `ddisa_auth_methods_supported` ergänzen: `['webauthn', 'ed25519', 'ssh-key']`

**Akzeptanzkriterien:**
- [ ] `pnpm turbo run build --filter=openape-free-idp` → erfolgreich
- [ ] `pnpm turbo run typecheck` → 0 Fehler
- [ ] `GET /.well-known/openid-configuration` enthält `ddisa_auth_challenge_endpoint`

**Rollback:** `git reset --hard HEAD~1`

---

### Milestone 6: E2E Tests umbauen

**Ziel:** E2E Tests nutzen SSH-Key Challenge-Response statt `POST /api/login`. Kein Playwright, kein WebAuthn-Mocking.

**Schritte:**

1. **Ändern** `examples/e2e/helpers/constants.ts`:
   ```typescript
   import { generateKeyPairSync } from 'node:crypto'

   // Deterministic test keypair (generated once, hardcoded for reproducibility)
   // Alternatively: generate fresh per test run
   const testKeyPair = generateKeyPairSync('ed25519')
   export const TEST_SSH_PRIVATE_KEY = testKeyPair.privateKey
   export const TEST_SSH_PUBLIC_KEY = testKeyPair.publicKey
     .export({ type: 'spki', format: 'der' })
   // ... format as ssh-ed25519 string for API calls
   ```
   Oder: hardcodiertes Test-Keypair als Base64 Strings.

2. **Neue Datei** `examples/e2e/helpers/key-auth.ts`:
   ```typescript
   export async function loginWithSshKey(
     baseUrl: string,
     email: string,
     privateKey: KeyObject,
     publicKeySsh: string,
     mgmtToken: string,
   ): Promise<string> {
     // 1. POST /api/auth/challenge { id: email }
     // 2. crypto.sign(null, Buffer.from(challenge), privateKey)
     // 3. POST /api/auth/authenticate { id: email, challenge, signature: base64, public_key: publicKeySsh }
     // 4. Return JWT token
   }
   ```

3. **Ändern** `examples/e2e/helpers/bootstrap.ts`:
   ```typescript
   export async function bootstrapTestUserSshKey(
     email: string,
     publicKeySsh: string,
     name?: string,
   ): Promise<void> {
     // POST /api/admin/users/:email/ssh-keys mit Management Token
   }
   ```

4. **Ändern** `examples/e2e/tests/login-flow.test.ts`:
   - `POST ${IDP_URL}/api/login` → SSH-Key Challenge-Response via `loginWithSshKey()`
   - Der JWT wird als `Authorization: Bearer ...` Header für den `/authorize` Flow genutzt
   - Kein CookieJar für IdP-Session nötig — der JWT authentifiziert direkt

5. **Alle anderen E2E Tests analog anpassen** (grant-visibility, grant-rerequest, sp-stateless-flow)

**Akzeptanzkriterien:**
- [ ] `pnpm turbo run test --filter=openape-e2e` → alle Tests grün
- [ ] Keine `POST /api/login` Aufrufe mehr in E2E Tests
- [ ] Kein Playwright oder Browser-Dependency in E2E Tests

**Rollback:** `git reset --hard HEAD~1`

---

## Kritische Dateien (Gesamtübersicht)

| Datei | Aktion | Milestone |
|-------|--------|-----------|
| `modules/nuxt-auth-idp/src/runtime/server/utils/ssh-key-store.ts` | NEU | 1 |
| `modules/nuxt-auth-idp/src/runtime/server/utils/stores.ts` | ÄNDERN | 1 |
| `modules/nuxt-auth-idp/src/runtime/server/utils/define-stores.ts` | ÄNDERN | 1 |
| `modules/nuxt-auth-idp/src/runtime/server/utils/agent-token.ts` | ERWEITERN | 2 |
| `modules/nuxt-auth-idp/src/runtime/server/utils/agent-auth.ts` | ERWEITERN | 2 |
| `modules/nuxt-auth-idp/src/runtime/server/routes/authorize.get.ts` | ÄNDERN | 2 |
| `modules/nuxt-auth-idp/src/runtime/server/api/auth/challenge.post.ts` | NEU | 3 |
| `modules/nuxt-auth-idp/src/runtime/server/api/auth/authenticate.post.ts` | NEU | 3 |
| `modules/nuxt-auth-idp/src/module.ts` | ÄNDERN | 3, 4 |
| `modules/nuxt-auth-idp/src/runtime/server/api/admin/users/[email]/ssh-keys.post.ts` | NEU | 4 |
| `modules/nuxt-auth-idp/src/runtime/server/api/admin/users/[email]/ssh-keys.get.ts` | NEU | 4 |
| `modules/nuxt-auth-idp/src/runtime/server/api/admin/users/[email]/ssh-keys/[keyId].delete.ts` | NEU | 4 |
| `modules/nuxt-auth-idp/src/runtime/server/api/admin/users/[email].delete.ts` | ÄNDERN | 4 |
| `apps/openape-free-idp/server/database/schema.ts` | ÄNDERN | 5 |
| `apps/openape-free-idp/server/utils/drizzle-ssh-key-store.ts` | NEU | 5 |
| `apps/openape-free-idp/server/plugins/04.idp-stores.ts` | ÄNDERN | 5 |
| `modules/nuxt-auth-idp/src/runtime/server/routes/well-known/openid-configuration.get.ts` | ÄNDERN | 5 |
| `examples/e2e/helpers/constants.ts` | ÄNDERN | 6 |
| `examples/e2e/helpers/key-auth.ts` | NEU | 6 |
| `examples/e2e/helpers/bootstrap.ts` | ÄNDERN | 6 |
| `examples/e2e/tests/login-flow.test.ts` | ÄNDERN | 6 |
| `examples/e2e/tests/*.test.ts` (übrige) | ÄNDERN | 6 |

## Progress

- [x] `[2026-04-03 13:55]` Milestone 1: SSH Key Store — 3c53018
- [x] `[2026-04-03 13:55]` Milestone 2: Generalisiertes Token-System — 54c6db5
- [x] `[2026-04-03 14:01]` Milestone 3: Unified Auth Endpoints — 88ba3a0
- [x] `[2026-04-03 14:02]` Milestone 4: Admin Key Management — df6a6fc
- [x] `[2026-04-03 14:22]` Milestone 5: Free-IdP Drizzle Store + OIDC Discovery — ee8fdff
- [x] `[2026-04-03 14:25]` Milestone 6: E2E Tests umbauen — 2ace96b

## Surprises & Discoveries

- `POST /api/login` existiert nicht als Endpoint im Modul. Die E2E Tests rufen ihn trotzdem auf — der muss irgendwo als Test-Only Route registriert sein oder wird als 200 OK von Nuxt's SPA-Fallback beantwortet. **Zu klären in Milestone 6.**

## Decision Log

| Datum | Entscheidung | Begründung | Alternativen verworfen |
|-------|-------------|------------|----------------------|
| 2026-04-03 | Admin-only Key-Registrierung zuerst | Hält ersten PR schlank und testbar. Self-Registration mit Email-Validation als separates Follow-Up-Issue. | Self-Registration im gleichen PR |
| 2026-04-03 | Agent-Endpoints unverändert lassen | DDISA-Rückwärtskompatibilität. Bestehende CLI (`apes login`) und Tests brechen nicht. | Agent-Endpoints zu /api/auth/* migrieren |
| 2026-04-03 | `challengeStore` aus Grant-Stores wiederverwenden | Identisches Challenge-Response-Pattern (32 bytes hex, 60s TTL). Kein neuer Store nötig. | Eigener SSH-Challenge-Store |
| 2026-04-03 | `findByPublicKey()` im unstorage-Default iterativ | Bei wenigen Keys pro User performant genug. Drizzle-Impl nutzt DB-Index. | Reverse-Index in unstorage |

## Session-Checkliste

> Jede Session (auch Folge-Sessions) beginnt mit dieser Checkliste:

1. Plan lesen, Progress-Section prüfen
2. Git-Log seit letztem Commit lesen
3. Dev-Server starten, Baseline-Test laufen lassen
4. Nächsten offenen Milestone identifizieren
5. Implementieren, nach jedem Milestone committen
6. E2E-Verifikation der Akzeptanzkriterien (durch UI/API, nicht nur Unit-Tests)
7. Progress-Section und Discoveries aktualisieren

## Outcomes & Retrospective

> Erst nach Abschluss aller Milestones ausfüllen.

- **Ergebnis:**
- **Abweichungen vom Plan:**
- **Learnings:**
