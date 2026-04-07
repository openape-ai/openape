# Plan: AgentStore in UserStore konsolidieren

> Dieser Plan muss **self-contained** sein: Ein Agent oder Mensch ohne Vorwissen muss ihn
> von oben nach unten lesen und ein funktionierendes Ergebnis produzieren können.
> Keine externen Referenzen, kein implizites Wissen. Alles Relevante steht hier.

## Purpose / Big Picture

- **Ziel:** Es gibt nur noch "User" — keine Unterscheidung zwischen Agent und Human außer dem `act` Claim im JWT (bestimmt durch das `owner` Feld). Der separate `AgentStore` wird eliminiert, alle Queries laufen über den `UserStore`.
- **Kontext:** Die Trennung Agent/Human ist ein historisches Artefakt. Der Nitro IdP (`apps/idp/`) und `@openape/server` verwenden bereits den unified UserStore. Das Nuxt-Modul (`nuxt-auth-idp`) und der Free-IdP (`openape-free-idp`) haben noch separate AgentStore-Implementierungen, die dieselbe DB-Tabelle (`users`) abfragen.
- **Scope:**
  - **Drin:** AgentStore eliminieren, UserStore erweitern, alle Konsumenten migrieren, CLI "(agent)" Label entfernen
  - **Nicht drin:** `/api/agent/*` Endpoints bleiben als Backward-Compatible Aliases (intern auf UserStore umgestellt)

## Repo-Orientierung

- **Projekt:** openape-monorepo, `/Users/patrickhofmann/Companies/private/repos/openape/openape-monorepo`
- **Relevante Dateien:**

  **Interfaces (ändern):**
  - `packages/auth/src/idp/stores.ts` — `UserStore` Interface: `findByApprover` hinzufügen
  - `packages/auth/src/idp/stores.ts` — `InMemoryUserStore`: `findByApprover` implementieren

  **Zu löschen:**
  - `modules/nuxt-auth-idp/src/runtime/server/utils/agent-store.ts` — AgentStore Interface + unstorage Impl
  - `apps/openape-free-idp/server/utils/drizzle-agent-store.ts` — Drizzle AgentStore Impl

  **Zu migrieren (nuxt-auth-idp Module):**
  - `modules/nuxt-auth-idp/src/runtime/server/utils/stores.ts` — `agentStore` aus Interface entfernen
  - `modules/nuxt-auth-idp/src/runtime/server/utils/define-stores.ts` — `defineAgentStore` entfernen
  - `modules/nuxt-auth-idp/src/runtime/server/utils/user-store.ts` — Erweitern: `findByOwner`, `findByApprover`, `update`, `delete` (aktuell nur `create`, `findByEmail`, `listUsers`, `deleteUser`)
  - 15+ API-Endpoints die `agentStore` importieren → auf `userStore` umstellen

  **Zu migrieren (Free-IdP):**
  - `apps/openape-free-idp/server/utils/drizzle-user-store.ts` — Erweitern (Filter `owner IS NULL` entfernen, `findByOwner`/`findByApprover` hinzufügen)
  - `apps/openape-free-idp/server/plugins/04.idp-stores.ts` — `defineAgentStore()` entfernen, `defineUserStore()` anpassen
  - `apps/openape-free-idp/server/api/my-agents/` — 4 Endpoints auf `userStore` umstellen
  - `apps/openape-free-idp/server/api/enroll.post.ts` — auf `userStore` umstellen

  **CLI:**
  - `packages/apes/src/commands/auth/login.ts:218` — "(agent)" Label entfernen

- **Tech-Stack:** TypeScript, h3/Nitro, Nuxt 4, Drizzle ORM, Vitest
- **Dev-Setup:**
  ```bash
  pnpm install
  pnpm turbo run build --filter=@openape/auth   # Auth-Package bauen nach Interface-Änderung
  pnpm turbo run test --filter=@openape/nuxt-auth-idp  # Module-Tests
  pnpm turbo run typecheck                       # Gesamter Monorepo
  pnpm lint                                       # ESLint
  ```

## Milestones

### Milestone 1: UserStore Interface erweitern

**Ziel:** `UserStore` in `@openape/auth` bekommt `findByApprover`. InMemoryUserStore implementiert es.

**Schritte:**
1. `packages/auth/src/idp/stores.ts` — `UserStore` Interface: `findByApprover: (approver: string) => Promise<User[]>` hinzufügen
2. `packages/auth/src/idp/stores.ts` — `InMemoryUserStore`: `findByApprover` implementieren (analog `findByOwner`)
3. `packages/server/src/idp/app.ts` oder relevante Handler — prüfen ob `findByApprover` irgendwo gebraucht wird (aktuell nur in `nuxt-auth-idp` grants handler)

**Akzeptanzkriterien:**
- [ ] `pnpm turbo run build --filter=@openape/auth` → erfolgreich
- [ ] `pnpm turbo run test --filter=@openape/auth` → alle Tests grün
- [ ] `InMemoryUserStore` hat `findByApprover` Methode

**Rollback:** `git checkout -- packages/auth/`

### Milestone 2: nuxt-auth-idp UserStore erweitern & AgentStore entfernen

**Ziel:** Das Nuxt-Modul hat keinen `AgentStore` mehr. Alle Endpoints benutzen `userStore`.

**Schritte:**

1. **UserStore erweitern** (`modules/nuxt-auth-idp/src/runtime/server/utils/user-store.ts`):
   - Interface auf `@openape/auth` UserStore angleichen
   - Methoden hinzufügen: `findByOwner`, `findByApprover`, `update`, `delete`
   - Filter `owner IS NULL` bei Queries ENTFERNEN — UserStore liefert jetzt ALLE User
   - `listUsers()` → `list()` (Signatur angleichen)

2. **Stores-Orchestrierung** (`modules/nuxt-auth-idp/src/runtime/server/utils/stores.ts`):
   - `agentStore` aus dem `IdpStores` Interface entfernen
   - Import von `createAgentStore` entfernen

3. **Define-Stores** (`modules/nuxt-auth-idp/src/runtime/server/utils/define-stores.ts`):
   - `defineAgentStore()` entfernen (Export bleibt evtl. als no-op für Backward-Compat)

4. **Agent-Store Datei löschen** (`modules/nuxt-auth-idp/src/runtime/server/utils/agent-store.ts`)

5. **API-Endpoints migrieren** — Für jeden Endpoint der `agentStore` benutzt:

   | Endpoint | Aktuell | Nachher |
   |----------|---------|---------|
   | `grants/index.get.ts` | `agentStore.findByOwner(email)`, `agentStore.findByApprover(email)` | `userStore.findByOwner(email)`, `userStore.findByApprover(email)` |
   | `grants/[id]/approve.post.ts` | `agentStore.findByEmail(requester)` | `userStore.findByEmail(requester)` |
   | `grants/[id]/deny.post.ts` | `agentStore.findByEmail(requester)` | `userStore.findByEmail(requester)` |
   | `grants/[id]/revoke.post.ts` | `agentStore.findByEmail(requester)` | `userStore.findByEmail(requester)` |
   | `agent/challenge.post.ts` | `agentStore.findByEmail/findById` | `userStore.findByEmail` (kein findById nötig — User werden per email identifiziert) |
   | `agent/authenticate.post.ts` | `agentStore.findByEmail/findById` | `userStore.findByEmail` |
   | `auth/challenge.post.ts` | `agentStore.findByEmail/findById` | `userStore.findByEmail` |
   | `auth/authenticate.post.ts` | `agentStore.findByEmail/findById` | `userStore.findByEmail` |
   | `session/login.post.ts` | `agentStore.findByEmail/findById` | `userStore.findByEmail` |
   | `agent/enroll.post.ts` | `agentStore.findByEmail/create/listAll` | `userStore.findByEmail/create/list` |
   | `admin/agents/index.get.ts` | `agentStore.listAll()` | `userStore.list()` (mit owner-Filter oder eigener Query) |
   | `admin/agents/index.post.ts` | `agentStore.create()` | `userStore.create()` |
   | `admin/agents/[id].get.ts` | `agentStore.findById(id)` | `userStore.findByEmail(id)` (ID = email im unified model) |
   | `admin/agents/[id].put.ts` | `agentStore.update(id, ...)` | `userStore.update(email, ...)` |
   | `admin/agents/[id].delete.ts` | `agentStore.delete(id)` | `userStore.delete(email)` |

   **Wichtig bei Approve/Deny/Revoke:** Diese Endpoints prüfen `agent.owner === email` oder `agent.approver === email`. Die Logik bleibt gleich, nur `agent` wird zu `user`: `user.owner === email`.

6. **Tests anpassen** — Mocks in Tests die `agentStore` referenzieren auf `userStore` umstellen:
   - `test/grants-create.test.ts` — Mock von `agent-auth` und `grant-stores`
   - Alle Tests die `useIdpStores` mocken

**Akzeptanzkriterien:**
- [ ] `pnpm turbo run test --filter=@openape/nuxt-auth-idp` → alle Tests grün
- [ ] `pnpm turbo run typecheck --filter=@openape/nuxt-auth-idp` → kein Fehler
- [ ] `pnpm lint` → clean
- [ ] `grep -r 'agentStore' modules/nuxt-auth-idp/src/` → keine Treffer
- [ ] `grep -r 'agent-store' modules/nuxt-auth-idp/src/` → keine Treffer (außer evtl. deprecated export)

**Rollback:** `git checkout -- modules/nuxt-auth-idp/`

### Milestone 3: Free-IdP migrieren

**Ziel:** Free-IdP verwendet nur noch `userStore`, kein `agentStore` mehr.

**Schritte:**

1. **Drizzle UserStore erweitern** (`apps/openape-free-idp/server/utils/drizzle-user-store.ts`):
   - Filter `owner IS NULL` entfernen
   - `findByOwner(owner)`, `findByApprover(approver)` hinzufügen
   - `update(email, data)` hinzufügen
   - Interface auf `@openape/auth` UserStore angleichen

2. **Drizzle AgentStore löschen** (`apps/openape-free-idp/server/utils/drizzle-agent-store.ts`)

3. **Plugin anpassen** (`apps/openape-free-idp/server/plugins/04.idp-stores.ts`):
   - `defineAgentStore(() => createDrizzleAgentStore())` entfernen
   - `defineUserStore(() => createDrizzleUserStore())` sicherstellen

4. **my-agents Endpoints migrieren** (`apps/openape-free-idp/server/api/my-agents/`):
   - `index.get.ts` — `userStore.findByOwner(email)` statt `agentStore.findByOwner(email)`
   - `[id].get.ts` — `userStore.findByEmail(id)` statt `agentStore.findById(id)`
   - `[id].patch.ts` — `userStore.update(email, ...)` statt `agentStore.update(id, ...)`
   - `[id].delete.ts` — `userStore.delete(email)` statt `agentStore.delete(id)`

5. **Enroll Endpoint** (`apps/openape-free-idp/server/api/enroll.post.ts`):
   - `userStore.findByOwner(email)` statt `agentStore.findByOwner(email)`
   - `userStore.create(...)` statt `agentStore.create(...)`

**Akzeptanzkriterien:**
- [ ] `pnpm turbo run build --filter=openape-free-idp` → erfolgreich
- [ ] `pnpm turbo run typecheck` → kein Fehler
- [ ] `grep -r 'agentStore\|agent-store\|AgentStore' apps/openape-free-idp/server/` → keine Treffer
- [ ] Lokal starten: `node .output/server/index.mjs` → Grants-Seite zeigt korrekt Grants an

**Rollback:** `git checkout -- apps/openape-free-idp/`

### Milestone 4: CLI "(agent)" Label entfernen

**Ziel:** `apes login` zeigt bei Key-Login keinen "(agent)" Suffix mehr.

**Schritte:**
1. `packages/apes/src/commands/auth/login.ts:218` — `(agent)` entfernen, gleiche Success-Message wie bei PKCE-Login

**Akzeptanzkriterien:**
- [ ] `pnpm turbo run test --filter=@openape/apes` → alle Tests grün
- [ ] `pnpm turbo run typecheck --filter=@openape/apes` → kein Fehler

**Rollback:** `git checkout -- packages/apes/`

### Milestone 5: Deploy & Verifizieren

**Ziel:** Alles deployed und funktionierend.

**Schritte:**
1. Alle Tests, Typecheck, Lint final prüfen
2. Commit & Push
3. `vercel --prod` für Free-IdP
4. Auf https://id.openape.at einloggen, Grants prüfen
5. `apes login` testen

**Akzeptanzkriterien:**
- [ ] https://id.openape.at — Grants werden korrekt angezeigt
- [ ] `apes login --key ~/.ssh/id_ed25519` → kein "(agent)" in Output
- [ ] `pnpm turbo run test` → alle Tests grün
- [ ] `pnpm lint && pnpm typecheck` → clean

## Progress

- [ ] `[2026-04-07]` Milestone 1: Pending
- [ ] `[2026-04-07]` Milestone 2: Pending
- [ ] `[2026-04-07]` Milestone 3: Pending
- [ ] `[2026-04-07]` Milestone 4: Pending
- [ ] `[2026-04-07]` Milestone 5: Pending

## Surprises & Discoveries

(wird laufend aktualisiert)

## Decision Log

| Datum | Entscheidung | Begründung | Alternativen verworfen |
|-------|-------------|------------|----------------------|
| 2026-04-07 | `/api/agent/*` Endpoints bleiben als Aliases | Backward-Compatibility für bestehende CLI-Versionen und externe Clients | Löschen (breaking change) |
| 2026-04-07 | `findByApprover` in UserStore aufnehmen | Wird für Grant-Authorization benötigt (wer darf Grants eines Users genehmigen) | Nur findByOwner, approver-Check in-memory |
| 2026-04-07 | UserStore liefert ALLE User (kein owner-Filter) | Unified Model — Filtering ist Aufgabe des Consumers, nicht des Stores | Separate list-Methoden für humans/agents |

## Session-Checkliste

1. Plan lesen, Progress-Section prüfen
2. Git-Log seit letztem Commit lesen
3. Dev-Server starten, Baseline-Test laufen lassen
4. Nächsten offenen Milestone identifizieren
5. Implementieren, nach jedem Milestone committen
6. E2E-Verifikation der Akzeptanzkriterien (durch UI/API, nicht nur Unit-Tests)
7. Progress-Section und Discoveries aktualisieren
