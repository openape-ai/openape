# Goal (user-visible)

Nach diesem Plan:
1. Ein **Service-Agent** ist ein echter, Nest-verwalteter Agent (eigene DDISA-Identität, eigener OS-User, pm2-supervised) — ein **Worker**, symmetrisch zum User-Agent: statt an troop-chat bindet er sich an **ein SP-Backend**, **zieht dort Tasks, löst sie autonom (LLM + Tools), liefert Resultat + Zwischenergebnisse**.
2. **zaz hält keinen LLM-Key mehr und macht keine LLM-Orchestrierung mehr.** zaz enqueued bei einer Operation (Extract/Phrases) einen Task; sein Service-Agent zieht ihn, verarbeitet ihn über das Nest-LLM und liefert das Ergebnis zurück.
3. Für den End-User sichtbar besser: **Progress/Zwischenergebnisse** (der Agent postet Partials während er arbeitet).
4. Referenz-Integration ist zaz; das Muster (2 SP-Routen + generischer Agent) ist für jeden SP wiederverwendbar.

**v1-Scope (Patrick, 2026-06-07): autonomer Task-Worker, rein-pollend.** Der SP definiert den Task (Domain-Prompt + Material + Output-Contract + erlaubte Tools); der Agent ist der **generische** Executor (LLM + Tools + Loop + Audit). Wake-Push und SP-Callback (Agent ruft delegiert in den SP zurück) sind bewusste Folge-Schritte.

# Kontext (self-contained)

- **Nest** (`apps/openape-nest`, `@openape/nest`) = lokaler Control-Plane-Daemon auf chatty: pm2-Supervisor + troop-sync + Registry (`/var/openape/nest/agents.json`). Spawnt Agents als OS-User; jeder läuft eine `ape-agent`-Bridge.
- **User-Agent heute** (`apps/openape-ape-agent/src/bridge.ts`): verbindet sich per WebSocket mit troop-chat, zieht Nachrichten, läuft `runLoop` (`packages/agent-runtime/src/agent-runtime.ts`: System-Prompt+History → `${apiBase}/chat/completions` mit Tools → Tool-Calls ausführen → Loop), streamt Ergebnisse zurück. **Der Service-Agent ist dasselbe Muster mit getauschtem Backend** (`ChatBackend` → `TaskBackend`).
- **Nest-LLM** = `@openape/codex-proxy`, systemd `codex-proxy.service` auf chatty, `127.0.0.1:4001`, OpenAI-kompatibel (streaming + non-streaming + tool-calls + `/v1/models`; ChatGPT-Subscription, `gpt-5.5`). Alleinige LLM-Quelle (litellm 2026-06-07 entfernt).
- **zaz heute** (`~/Companies/delta-mind/repos/zaz`): SP-Backend, ruft das LLM **direkt** — `server/utils/llm.ts` `chat()` → `:4001` mit `NUXT_LITELLM_API_KEY`; Nutzer `extract.post.ts` (2-Versuch-Korrektur inline) + `wordlists.ts` (phrases). zaz **hält den LLM-Key + macht die Orchestrierung** → genau das wandert in den Agent.
- **Vorhandene Bausteine:** Delegation RFC 8693 (`modules/nuxt-auth-idp/.../oauth/token-exchange.post.ts`), Grants (`packages/grants`), `act`-Claim + SP-Erkennung (`modules/nuxt-auth-sp/.../utils/grants.ts`), Egress-Proxy (`packages/proxy`), `requireCaller` im SP (akzeptiert `act:'agent'`).
- **Verhältnis zu anderen Plänen:** `01KTCBFW…` liefert „das Nest **hält** das LLM" (codex-proxy). DIESER Plan: „wie ein SP-Backend das LLM **konsumiert** — über einen Task-ziehenden Service-Agent". Kein Duplikat.

# Architektur (Ziel v1) — Pull-Work-Queue

```
End-User klickt „Extract" in zaz
        │  zaz enqueued Task {type:'extract', prompt+material+schema+tools}
        ▼
   zaz (SP)  ── 2 Routen, auth = gebundener Agent (act:agent) ──┐
     GET  /api/agent/tasks/next      → least 1 Task atomar       │   (Wake optional:
          (lease/visibility-timeout) oder leer                   │    WS/WebPush/SSE,
     POST /api/agent/tasks/:id/resolve {status, partial|result}  │    datenlos „poll now")
          (mehrfach → Zwischenergebnisse)                        │
        ▲                                                        │
        │  pull / resolve                                        ▼
   zaz-service-agent (Nest-managed, kind=service, DDISA-Identität, OS-User, pm2)
     Loop: GetNextTask → runLoop(task)  [LLM via :4001 + Tools + Retry] → ResolveTask(progress…) → ResolveTask(done)
        │
        ▼
   codex-proxy :4001 ──► ChatGPT-Backend (gpt-5.5)

Browser ◄─ zaz streamt Progress/Final an die UI, wie die Partials via ResolveTask eintreffen.
```

- **SP-Kontrakt = 2 Routen.** `GetNextTask` (atomare Lease), `ResolveTask` (status: `progress|done|error`, mehrfach für Zwischenergebnisse). Beide nur für den gebundenen Agent (DDISA `act:agent`).
- **Wake-Signal optional + transport-agnostisch** (WS/WebPush/SSE) — nur „jetzt pollen", trägt keine Daten. v1 rein-pollend; Wake = Latenz-Optimierung (M4).
- **Agent generisch, SP-owned Task.** Derselbe Agent serviert jeden SP; zaz besitzt seinen Extract-Prompt/Schema und schickt ihn im Task. Der Agent bringt: LLM-Zugang (zaz hat keinen), Tools, autonomen Loop (die heutige 2-Versuch-Korrektur), Progress, Audit.
- **Credential-Isolation:** zaz hält keinen LLM-Key; der Agent hat ihn (Nest codex-proxy).
- **Standards statt Eigenbau** (Recherche 2026-06-07): Task-Objekt + State-Machine = **A2A** (Linux-Foundation; `submitted→working→(input-required|auth-required)→completed`, terminal auch `failed/canceled/rejected`; `Task{id,contextId,status,artifacts[],history[]}`, `Message/Part/Artifact`). Queue-Mechanik = **SQS-Stil** (atomare Lease via visibility-timeout, Ack via Delete, Progress verlängert die Lease, Expiry→Redelivery). Envelope optional CloudEvents 1.0. **JSON-RPC-Stringform** verwenden (`working`, nicht `TASK_STATE_WORKING`). Interner Store in A2A-Feldnamen → später dünne **A2A-JSON-RPC-Façade** (`message/send`, `message/stream`, `tasks/get`, `tasks/pushNotificationConfig/*`) macht den SP nach außen zu einem A2A-Remote-Agent ohne Daten-Remodeling. **A2As Push-Notification-Webhook = unser optionales Wake-Signal.**

# Prerequisites
- [x] codex-proxy live auf chatty (`:4001`, gpt-5.5), OpenAI-konform (Plan `01KTGSEH…` done).
- [x] zaz läuft auf chatty (`zaz.service`, `:3013`).
- [x] Nest spawnt/verwaltet Agents (pm2, Registry) + User-Agent-Bridge/`runLoop` vorhanden.
- [ ] Forgejo-Branch je Milestone (issue-first), CI grün vor Merge.

# Milestones

## M0 — LLM-Endpoint vereinheitlichen (Aufräumen nach litellm-Removal)
**Goal:** Alles zeigt auf codex-proxy `:4001`; toter `:4000`-Default + obsoleter `streamAggregate`-Workaround weg.
**Steps:** (1) `apps/openape-ape-agent/src/bridge.ts` Default `LITELLM_BASE_URL` `:4000`→`:4001`. (2) `packages/agent-runtime/src/agent-runtime.ts`: `streamAggregate` unnötig (codex-proxy liefert non-stream JSON) → Default aus / deprecated, Tests anpassen. (3) Nest-Spawn-Env (`pm2-supervisor.ts`) auf `:4001`.
**Proof:** Frisch gespawnter User-Agent antwortet über `:4001`; `rg ":4000" apps packages` nur Tests/Doku.

## M1 — `@openape/sp-tasks` Task-Channel (die 2 Routen + Queue) — A2A-geshaped + SQS-Lease
**Goal:** Ein wiederverwendbares Companion-Package, das jeder SP einbindet: Queue + `GetNextTask` (atomare SQS-Lease) + `ResolveTask` (A2A status/artifact-updates: progress/done/error). Agent-authentifiziert (`act:agent`, gebundener Agent via nuxt-auth-sp `requireCaller` + Agent-Email aus SP-Config).
**Steps:** (1) Store (Drizzle `agent_tasks`) in **A2A-Feldnamen**: `id, contextId, status_state[submitted|working|input-required|auth-required|completed|failed|canceled|rejected], history(json), artifacts(json), assignee, lease_until, deliveryCount, createdAt`. (2) `GetNextTask` = ReceiveMessage: atomar das älteste `submitted` (oder `working` mit abgelaufener Lease) auf `working`+`lease_until`+`assignee` setzen und als A2A-**Task** zurückgeben (SQLite `UPDATE…WHERE id=(SELECT…LIMIT 1) RETURNING`) inkl. Lease-Token. (3) `ResolveTask`: `progress`→`artifact-update`(append/lastChunk) **+ Lease verlängern** (ChangeMessageVisibility); `done|error`→Terminal-State + `final:true` + ack. (4) Package `@openape/sp-tasks` (nutzt `@openape/nuxt-auth-sp`). (5) TDD: atomare Lease (kein Doppel-Lease bei 2 parallelen Polls), Lease-Expiry→Redelivery (`deliveryCount++`/Dead-Letter-Cap), progress-then-done; States ∈ A2A-Enum.
**Proof:** Task enqueuen; zwei parallele `GetNextTask` → nur einer kriegt ihn; Lease-Expiry → re-leasebar (`deliveryCount` steigt); `ResolveTask done` → `status_state=completed`+`final:true`, Result lesbar. Unit-Tests grün; Felder/States A2A-konform.

## M2 — Service-Agent Worker (rein-pollend)
**Goal:** Nest-`kind:service`-Agent, der die GetNextTask seines SP pollt, `runLoop` fährt (LLM `:4001` + Tools) und ResolveTask(progress+done) postet.
**Steps:** (1) Registry `AgentEntry.kind:'user'|'service'` (+`service:{ servesSp, baseUrl, pollIntervalMs }`), Mirror in `packages/apes/src/lib/nest-registry.ts`. (2) Neue **task-worker-Bridge** (`apps/openape-ape-agent/src/service-bridge.ts`): Loop `GetNextTask`(auth via Agent-Identität) → `runLoop(task.payload)` → `ResolveTask`; Audit-Row je Task. (3) `pm2-supervisor.ts`: bei `kind==='service'` task-worker statt chat-bridge. (4) `apes agents spawn <name> --kind service --serves <sp>`. (5) TDD auf die Worker-Schleifenlogik (mock SP: ein Task → resolve-Aufrufe mit progress+done).
**Proof:** `apes agents spawn zaz-svc --kind service --serves zaz`; manuell einen Test-Task in zaz enqueuen → Agent zieht ihn, ruft `:4001`, postet `ResolveTask done` mit Ergebnis; `~/.openape/agent/audit.jsonl` hat eine Zeile; `pm2 jlist` zeigt `openape-service-zaz-svc online`.

## M3 — zaz extract/phrases auf das Task-Modell (Cutover)
**Goal:** zaz enqueued statt inline-LLM; der Agent löst; zaz hält **keinen LLM-Key**. 2-Versuch-Korrektur wandert in den Agent-Loop.
**Steps:** (1) `extract.post.ts` + `wordlists.ts`: statt `chat()` einen Task enqueuen (`{type, prompt, material, schema}`) + auf `done` warten (intern: Promise/Poll auf den Task) und an die UI streamen. (2) `wordlists.ts`/`llm.ts`-Direktpfad entfernen; `NUXT_LITELLM_BASE_URL`/`_API_KEY` aus zaz raus (kennt `:4001` nicht mehr). (3) Den `requireCaller`-User in den Task schreiben (on-behalf-of im Audit). 
**Proof:** Echter zaz-Extract (Wegwerf-Projekt + geminte `openape-sp`-Session) → `ok=true`, gelöst **vom Agent** (Audit-Row trägt den User); `sudo grep -iE "4001|NUXT_LITELLM_API_KEY" zaz .env` → kein LLM-Key/Endpoint mehr.

## M4 (optional) — Wake-Signal (Latenz)
**Goal:** Push „poll now" statt Poll-Intervall, transport-austauschbar.
**Steps:** kleinste Variante zuerst (SSE oder WS vom SP), datenlos; Agent pollt bei Signal sofort. Fällt der Push aus → Poll-Fallback greift.
**Proof:** Task-Pickup < ~200 ms ohne auf das Poll-Intervall zu warten; Push killen → Pickup fällt auf Intervall zurück (kein Fehler).

# Decision Log
| Entscheidung | Gewählt | Warum |
|---|---|---|
| Was ist ein Service-Agent | **Echter per-SP Agent-Prozess** (DDISA, Nest-managed, OS-User) | „sind agents"; reused Nest-Lifecycle/runLoop/Tools/Delegation. *(Patrick, 2026-06-07)* |
| Verbindungs-Richtung | **Agent zieht Task vom SP** (Pull-Queue), NICHT SP→Agent | SP→Agent wäre nur ein verkappter Proxy (= „LLM dem SP freigeben"). Der Agent muss autonomer Worker sein, der Tasks holt/verarbeitet/liefert. *(Patrick, 2026-06-07)* |
| SP-Kontrakt | **Genau 2 Routen:** `GetNextTask` + `ResolveTask` | minimal, in jedem SP wiederverwendbar; `ResolveTask` mehrfach = Zwischenergebnisse. *(Patrick, 2026-06-07)* |
| Wake-Signal | **optional + transport-agnostisch** (WS/WebPush/SSE), datenlos | trennt Transport von Semantik; Poll funktioniert ohne Wake → resilient. v1 rein-pollend. *(Patrick, 2026-06-07)* |
| Task-Definition | SP-owned, Agent generisch | derselbe Agent serviert jeden SP; SP besitzt Domain (Prompt/Schema). |
| **Task-Schema + State-Machine** | **A2A** (Linux-Foundation), JSON-RPC-Stringform: `submitted/working/input-required/auth-required/completed/failed/canceled/rejected`; `Task/Message/Part/Artifact` | kein Worker-Pull-Standard existiert; A2A = LF-governed Front-runner + richtungsneutrales Objektmodell → später A2A-Façade = Interop. *(Recherche 2026-06-07)* |
| **Lease/Ack-Mechanik** | **SQS-Stil:** GetNextTask=ReceiveMessage(+visibility-timeout-Lease+receipt), ResolveTask(done)=DeleteMessage, ResolveTask(progress)=ChangeMessageVisibility; Expiry→Redelivery (at-least-once, deliveryCount/Dead-Letter) | kanonische, allseits bekannte atomare-Lease+Ack-Semantik. *(Recherche 2026-06-07)* |
| Envelope | CloudEvents 1.0 (optional, Wake-Signal + Bodies) | CNCF-graduated; Wrapper + A2A-Task als Payload. |
| Wo läuft der zaz-Agent | **OS-User auf chatty via Nest** | konsistent mit den anderen Nest-Agents. *(Patrick, 2026-06-07)* |
| Task-Channel-Packaging | **eigenes `@openape/sp-tasks`-Companion** (nutzt nuxt-auth-sp `requireCaller`) | wiederverwendbar, entkoppelt. *(Patrick, 2026-06-07)* |
| v1 lässt aus | Wake-Push (M4), SP-Callback (Agent ruft delegiert in SP zurück), voller RFC-8693-Delegations-Token, A2A-Façade nach außen | Scope-Schnitt; bauen sauber auf v1 auf (Store schon A2A-geshaped). |

# Risks & Mitigations
- **Atomare Lease ist das kritische Stück** (Doppel-Processing): SQLite `UPDATE…RETURNING` mit `lease_until`; Lease-Expiry re-queued. TDD genau darauf.
- **Synchrone UX:** zaz-HTTP-Handler enqueued + wartet auf `done` (mit Timeout) bzw. streamt Progress an den Browser. Agent down → Task wartet/Timeout → SP zeigt Fehler. SPOF-Klasse wie heute; Nest-pm2 restartet den Agent.
- **At-least-once:** ein Task kann (nach Lease-Expiry) doppelt laufen → Tasks idempotent halten oder Ergebnis per `taskId` überschreiben.
- **Per-SP-Bindung:** SP-Config kennt seine Agent-Email; nur die darf pollen/resolven (DDISA-auth). Falsche Identität → 401/403.
- **M0 stört evtl. laufende User-Agents** (Endpoint-Wechsel) — aktuell keine produktiven; sonst rolling restart.

# Open Questions
1. ~~Wo läuft der zaz-Service-Agent~~ → **OS-User auf chatty via Nest** (Patrick, 2026-06-07).
2. ~~Task-Channel-Packaging~~ → **eigenes `@openape/sp-tasks`-Companion** (Patrick, 2026-06-07).
3. Stufe-2 (Agent ruft mit delegierter Identität in den SP zurück, holt Daten selbst statt self-contained Task) als eigener Plan?
4. A2A-JSON-RPC-Façade nach außen jetzt schon mit-vorsehen oder erst wenn externer A2A-Interop konkret wird? (Empfehlung: Store A2A-geshaped halten, Façade später.)

# E2E-Verifikation (Definition of Done)
```
# 1. Service-Agent läuft & pollt:
apes agents list | rg "zaz-svc.*service.*online"
# 2. Queue-Mechanik: Task enqueuen → Agent zieht → resolve done:
#    (Test-Task via zaz-DB/Route) → tail audit.jsonl zeigt {ts, sp:"zaz", task, oboe:<user>}
# 3. Echter zaz-Extract (Wegwerf-Projekt + geminte Session) → ok=true, GELÖST vom Agent (Audit), Progress sichtbar.
# 4. zaz hält keinen LLM-Key/Endpoint:
sudo grep -iE "NUXT_LITELLM_API_KEY|4001" /home/openape/projects/zaz/shared/.env   # → leer
```

# Progress
- [ ] M0 — LLM-Endpoint vereinheitlichen (:4001, streamAggregate raus)
- [ ] M1 — SP Task-Channel (GetNextTask + ResolveTask + Queue, atomare Lease) — wiederverwendbar
- [ ] M2 — Service-Agent Worker (kind:service, rein-pollend, runLoop)
- [ ] M3 — zaz extract/phrases auf Task-Modell (Cutover, zaz keyless)
- [ ] M4 (optional) — Wake-Signal (Latenz)
- Folge (eigener Plan): SP-Callback (delegiert), RFC-8693-Token, weitere SPs
