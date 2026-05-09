# Plan: Delegation-Pipeline mit RFC-8693 Token-Exchange

> Self-contained.

## Purpose / Big Picture

Aktueller Hack: wenn der Nest (selbst ein Agent) im Auftrag von Patrick einen neuen Agent enrollt, ratet die IdP-Endpoint `/api/enroll` über einen Lookup im UserStore wer der "echte" Owner ist. Das ist eine Defensive-Heuristik ohne kryptographische Basis — Audit ist verschmiert ("der Nest hat enrolled"), und der Mechanismus skaliert nicht (jede neue Operation muss owner-Lookups einbauen).

Sauberer Weg ist DDISA-Standard: **delegated tokens** mit RFC-8693 Token-Exchange.

- **Patrick** erteilt dem **Nest** einmalig eine **Delegation** ("dieser Agent darf in meinem Namen handeln" mit Scope `enroll-agent`).
- Der **Nest** authentifiziert beim Enroll seinen eigenen Token UND präsentiert den Delegation-Grant. Das IdP **tauscht** das in einen neuen Token mit `sub: patrick@hofmann.eco`, `act: { sub: nest-…@id.openape.ai, type: agent }`.
- `/api/enroll` schaut nur auf `sub` — der Owner ist Patrick, der Actor ist der Nest. Audit-Trail ist sauber im Token, kein Server-side Heuristik nötig.

- **Ziel:** Nach diesem Plan kann der Nest `apes agents register` mit einem **delegated token** aufrufen, das IdP setzt den neuen Agent zu Patrick zugeordnet OHNE die transitive-ownership-Heuristik in `enroll.post.ts`. Die Heuristik wird entfernt.
- **Kontext:** Ende des 2026-05-09 Sessions als nächster Schritt nach Nest-DDISA-SP identifiziert. Reduziert Server-side Magic, ist Vorbereitung für Cross-Device + Agent-zu-Agent.
- **Scope:**
  - **drin:** Neue IdP-Endpoint `POST /api/oauth/token-exchange` (RFC-8693), CLI-side `exchangeWithDelegation()` Helper, Delegation-Lookup im Nest-Enroll-Flow, Cleanup der transitive-ownership Heuristik in `enroll.post.ts`.
  - **nicht drin:** Cross-Device (kommt natürlich draus), generische Verwendung in anderen Endpoints (kann bei Bedarf nachgezogen werden), Migrationspfad für existierende Agents (Nest hat einen, Patrick→Nest Delegation muss einmal manuell erstellt werden).

## Repo-Orientierung

- **Projekt:** OpenApe Monorepo
- **Pfad:** `/Users/patrickhofmann/Companies/private/repos/openape/openape-monorepo`
- **Tech-Stack:** Node.js 22+, h3 (Nuxt server routes), `@openape/grants` (Delegation-CRUD), `jose` (JWT mint+verify).

### Relevante Dateien

| Pfad | Zweck |
|---|---|
| `apps/openape-free-idp/server/api/oauth/token-exchange.post.ts` | **NEU** — RFC-8693 Endpoint |
| `apps/openape-free-idp/server/api/enroll.post.ts` | Cleanup: transitive-ownership Heuristik raus, ersetzt durch act-claim Read |
| `modules/nuxt-auth-idp/src/runtime/server/utils/admin.ts` | `requireAuth()` returnt jetzt `{ sub, act }` statt nur `sub` |
| `packages/grants/src/grants.ts` | bestehende `validateDelegation()` reuse — verifiziert delegate/audience/scope match |
| `packages/cli-auth/src/exchange.ts` | erweitert um `exchangeWithDelegation()` |
| `packages/apes/src/lib/agent-bootstrap.ts` | `registerAgentAtIdp()` benutzt delegated token wenn der Caller ein Agent ist |

## Milestones

### Milestone 1: IdP Token-Exchange-Endpoint

**Ziel:** `POST /api/oauth/token-exchange` akzeptiert `{ subject_token, actor_token, grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange', delegation_grant_id?, requested_token_type?, audience? }` und mintet einen Token mit `sub` aus subject_token + `act` aus actor_token. Verifiziert: subject_token & actor_token sind valide IdP-Tokens, der Delegation-Grant (falls angegeben) ist active, der actor ist der `delegate`, der subject ist der `delegator`. Ablehnt: invalid sigs, expired, falsche delegate/delegator-Kombo.

**Akzeptanz:** `curl -X POST $IDP/api/oauth/token-exchange -d '{...}'` mit gültigen Parametern returned ein JWT mit `sub=Patrick`, `act.sub=Nest`, `act.type=agent`. Mit ungültiger Delegation: 403 + Problem-JSON mit klarem Reason. Lint+typecheck+build grün.

### Milestone 2: CLI-side Token-Exchange + delegated registerAgentAtIdp

**Ziel:** `packages/cli-auth/src/exchange.ts` exportiert `exchangeWithDelegation()` neu. `packages/apes/src/lib/agent-bootstrap.ts:registerAgentAtIdp()` checkt: ist der lokale Caller ein Agent? Falls ja, sucht via `apes grants delegations list` nach einer aktiven Delegation für `audience='enroll-agent'` von Patrick zu mir. Fund: ruft Token-Exchange, nutzt delegated token im `/api/enroll` Call. Kein Fund: Aufruf wie heute (mit transitive-ownership-Hack als Sicherheitsnetz noch aktiv).

**Akzeptanz:** Manueller Test: `apes grants delegate --to nest-…@id.openape.ai --audience enroll-agent --grant-type always` (einmal von Patrick). Dann `apes nest spawn igor20` → Nest macht Token-Exchange → IdP sieht `act.sub=nest, sub=patrick` im Token → `enroll.post.ts` ist (immer noch im Hack-Pfad, M3 räumt auf) bekommt `act.sub` und `sub` getrennt. Beweis: igor20 erscheint korrekt mit `cb6bf26a` Hash (Patrick's hash) in der agent list, AUSSERDEM zeigt der IdP-Audit-Log dass `act` gesetzt war.

### Milestone 3: Cleanup

**Ziel:** `requireAuth()` returnt jetzt `{ sub, act }`. `enroll.post.ts` benutzt nur `sub` für owner attribution, der `callerRecord?.type === 'agent' && callerRecord.owner` Hack ist gelöscht. Negative Test: Direct-Call von Nest-Token (ohne Delegation) auf `/api/enroll` → erhält `act='agent'` aber kein delegierter `sub` → IdP setzt owner=requester (= Nest selbst). Das ist absichtliches Verhalten — wer nicht delegiert, der enrollt für sich selbst (und wird über die `maxAgentsPerUser` Quota auf den Nest gewertet).

**Akzeptanz:** Vorhandene Heuristik in enroll.post.ts gelöscht. Neuer e2e: `apes nest spawn igor21` → owner=Patrick (durch Token-Exchange). Negative case: simulierter Direct-Nest-Call ohne Delegation → owner=Nest. Tests im IdP-Repo grün.

## Progress

- [ ] `[2026-05-09 18:30]` Plan geschrieben — los
- [ ] M1: Token-Exchange-Endpoint
- [ ] M2: CLI-side + apes agents register integration
- [ ] M3: enroll.post.ts cleanup

## Surprises & Discoveries

(Während Implementation füllen)

## Decision Log

| Datum | Entscheidung | Begründung |
|-------|-------------|------------|
| 2026-05-09 | Neuer Endpoint `/api/oauth/token-exchange` statt `/api/cli/exchange` erweitern | Letzteres ist SP-side für IdP-Token-zu-SP-Token; das ist ein anderes Pattern (Audience-Wechsel innerhalb derselben Identität). RFC-8693 mit subject+actor ist eigene Kategorie. |
| 2026-05-09 | Delegation-Lookup heuristisch im CLI (Audience='enroll-agent', erste aktive Delegation gewinnt) | v1 Pragmatik. Saubere Lösung wäre ein expliziter `--delegation <id>` Flag; aber der Nest weiß den Grant-ID nicht apriori, also muss er suchen. Rate-limit ist über das delegations-list endpoint pagination natürlich gegeben. |
| 2026-05-09 | M3 lässt den Hack-Code als Fallback drin in M2, löscht ihn erst in M3 | Ermöglicht inkrementellen Rollout: Nest-Setups mit Delegation funktionieren neu, ohne Delegation funktionieren weiter wie heute. M3 zwingt auf Delegation. |
