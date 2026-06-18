# Plan: Codex-nativer PM-Orchestrator (model+thinking-getierte Parallel-Worker)

> Self-contained. Stand 2026-06-15. Owner: Patrick. Entscheidungen unten im Decision Log.

## Purpose / Big Picture

- **Ziel:** Ein autonomer **PM-Orchestrator** (selbst ein Codex-Agent, gpt-5.5 mit hohem
  Reasoning) zieht den Backlog, **triagiert** jede Aufgabe (Schwierigkeit × Typ), und
  **spawnt ephemere Per-Task-Worker parallel in der passenden Stärke** (Modell + reasoning_effort):
  z.B. 3× gpt-5.4-low für Quick-Wins gleichzeitig, 2× gpt-5.5-high für Recherche gleichzeitig.
  Er sammelt Ergebnisse ein und gated sie. Läuft **autonom, Codex-only** (ToC-konform für
  unbeaufsichtigten Betrieb), Patrick + Claude nur noch „agent equivalent" (Reviewer bei Bedarf).
- **Kontext:** Heute = 1 Bridge pro Agent, seriell, alle auf gpt-5.4/5.5 ohne Effort-Steuerung;
  der autonome Treiber war ein launchd-`claude -p`-**Opus**-Motor — ToC-mäßig falsch für Dauerbetrieb
  + nicht parallel + Trippelschritte. Dieser Plan ersetzt das durch echte Codex-Parallelität +
  Modell/Denk-Tiefe nach Bedarf.
- **Scope DRIN:** reasoning_effort-Plumbing, Agent-Spawn-Tool, ephemerer Worker-Lifecycle,
  PM-Persona + Triage-Protokoll, paralleler Fan-out + Collection, Retire des Opus-Motors.
  **NICHT drin:** neues Web-UI, Änderung am DDISA-Auth-Kern, M2-Nest-Umbau (läuft separat).

## Repo-Orientierung (aus Ist-Karte, mit Datei:Zeile)

- **Spawn-Vorlage:** `apps/openape-org/server/utils/spawn-member.ts:22-85` — ensureAuth →
  `POST /api/cli/exchange {scopes:['troop:spawn-agent']}` → `POST /api/agents/spawn-intent {name,recipe,system_prompt}`.
- **Troop-Spawn-API:** `apps/openape-troop/server/api/agents/spawn-intent.post.ts:44` (Scope `troop:spawn-agent`);
  Nest-Handler `apps/openape-nest/src/lib/troop-ws.ts:318` ruft `apes agents spawn`.
- **Spawn-CLI:** `packages/apes/src/commands/agents/spawn.ts:26`; Registry `packages/apes/src/lib/nest-registry.ts:87`.
- **Modell-Plumbing:** `APE_CHAT_BRIDGE_MODEL` → `apps/openape-ape-agent/src/bridge-config.ts:41` →
  RuntimeConfig.model `apps/openape-ape-agent/src/bridge.ts:184` → **LLM-Request `packages/agent-runtime/src/agent-runtime.ts:162-167`** (Injektionspunkt für reasoning_effort).
- **Per-Task-Model schon da:** `apps/openape-ape-agent/src/service-bridge.ts:53-64` (`parseTaskSpec` liest task.data.model) — Effort analog ergänzen.
- **Tools-Registry:** `packages/agent-runtime/src/agent-tools/index.ts:33`; http-Tool blockt Auth-Header `agent-tools/http.ts:10-18` → dediziertes Spawn-Tool nötig.
- **Destroy:** `packages/apes/src/commands/agents/destroy.ts:17` (`apes agents destroy <name> --force`).
- **PM-Persona-Vorlage:** `apps/openape-org/server/utils/persona-catalog.ts:88` (`project-manager`); agent-catalog Repo.
- **codex-proxy:** akzeptiert `reasoning_effort` bereits (verifiziert: gpt-5.5+effort:high → 200, kein Fehler); serviert gpt-5.5/5.4/5.4-mini.
- **Verify:** `pnpm turbo run lint typecheck test --filter=<pkg>`; codex-proxy `http://openape-llm:4000/v1`.

## Milestones

### M0 (Spike): reasoning_effort end-to-end beweisen
**Ziel:** Beweisen, dass ein per-Agent gesetzter `reasoning_effort` wirklich am codex-proxy ankommt + wirkt.
**Schritte:** in `agent-runtime.ts:162-167` requestBody optional `reasoning_effort` aus `opts.config.reasoningEffort` ergänzen; `RuntimeConfig` um `reasoningEffort?` erweitern; einen Testlauf mit effort=high vs low gegen den Proxy (Latenz/Qualität-Unterschied beobachtbar).
**Akzeptanz:** [ ] ein Worker mit effort=high schickt `reasoning_effort:"high"` an den Proxy (Proxy-Log/Trace); low vs high messbar unterschiedlich. **Rollback:** Feld ist optional → weglassen.

### M1: reasoning_effort + model per-Task/per-Agent plumben
**Ziel:** Modell UND Effort pro Worker steuerbar — via Env (`APE_CHAT_BRIDGE_REASONING_EFFORT`) UND per-Task (`task.data.reasoning_effort`/`model`).
**Schritte:** bridge-config.ts + RuntimeConfig + service-bridge parseTaskSpec; pm2-supervisor ecosystem-env-forward.
**Akzeptanz:** [ ] zwei Worker, einer 5.4-low einer 5.5-high, beide aus demselben Nest, jeder schickt seine Stärke. **Rollback:** Defaults = bisheriges Verhalten.

### M2: Agent-Spawn-Tool (`spawn`-Tool in agent-runtime)
**Ziel:** Ein Agent kann andere Agenten spawnen — als Tool, das die Auth intern handelt (http-Tool kann's nicht).
**Schritte:** neues Tool `agent-tools/spawn.ts` nach Vorlage spawn-member.ts: ensureFreshIdpAuth → /api/cli/exchange (troop:spawn-agent) → /api/agents/spawn-intent {name, recipe, model, reasoning_effort, one_shot}; in ALL_TOOLS registrieren; nur für Agenten mit dem Scope.
**Akzeptanz:** [ ] ein Test-Agent spawnt via Tool einen zweiten Agenten (in der Registry sichtbar). **Rollback:** Tool aus ALL_TOOLS nehmen.

### M3: Ephemerer Worker-Lifecycle (spawn → 1 Task → teardown)
**Ziel:** Ein Worker, der EINE Aufgabe macht und sich dann selbst abräumt — keine idle-Bridges.
**Schritte:** `one_shot`-Flag im Spawn; der Worker (service-bridge-Variante) zieht/erhält EINE Task, führt sie aus, postet Result, ruft dann `apes agents destroy <self>` (oder der PM räumt nach Result-Empfang ab). Vorsicht: sauberes Teardown (OS-User, pm2, IdP).
**Akzeptanz:** [ ] PM spawnt one_shot-Worker → Worker liefert Result → Worker ist aus der Registry weg, kein pm2-Rest. **Rollback:** one_shot=false = persistenter Agent (heutiges Verhalten).

### M4: PM-Orchestrator-Persona + Triage-Protokoll
**Ziel:** Eine `pm-orchestrator`-Persona (gpt-5.5, effort high) im agent-catalog, deren Protokoll triagiert + dispatcht.
**Schritte:** Recipe: Backlog ziehen (ape-tasks/forge-issues) → je Task klassifizieren {effort: low/med/high, model, type} → Worker spawnen (M2/M3-Tool) mit der Stärke → Result einsammeln → Gate (CI grün? DoD?) → mergen/eskalieren. Triage-Regeln: Doku/kleiner-Fix=5.4-low, Tests/mittel=5.5-med, Recherche/Architektur=5.5-high.
**Akzeptanz:** [ ] PM nimmt einen 5-Task-Backlog, triagiert korrekt (Log zeigt Tier je Task), spawnt die Worker. **Rollback:** Persona nicht spawnen.

### M5: Paralleler Fan-out + Collection + Gate
**Ziel:** N Worker GLEICHZEITIG, nicht seriell. PM feuert N spawn-intents parallel, sammelt N Results, gated.
**Schritte:** PM-Protokoll: bis zu K parallele Worker (K konfigurierbar, z.B. 5); spawn-intents nebenläufig; pollt alle Result-Tasks; bei Fertigstellung Gate je Result.
**Akzeptanz:** [ ] „3 Quick-Wins (5.4-low) + 2 Recherchen (5.5-high)" laufen NACHWEISLICH gleichzeitig (5 Worker zur selben Zeit in der Registry), Results kommen ein, PR/Tasks gated. **Rollback:** K=1 = seriell.

### M6: Opus-launchd-Motor retiren, PM übernimmt
**Ziel:** Der ToC-fragwürdige headless-Opus-Motor wird abgeschaltet; der Codex-PM ist der autonome Treiber. Claude/Patrick = agent-equivalent (Reviewer bei Bedarf, vom PM zuziehbar).
**Schritte:** launchd `com.openape.werkstatt-engine` unload; PM-Persona auf eigener Schedule; ein „escalate-to-human/claude"-Pfad für die Fälle, die der PM nicht selbst entscheidet.
**Akzeptanz:** [ ] PM läuft autonom ohne den Opus-Motor; Fortschritt + Eskalationen sichtbar. **Rollback:** Opus-Motor wieder laden.

## Decision Log
| Datum | Entscheidung | Begründung |
|-------|-------------|------------|
| 2026-06-15 | Worker = ephemer pro Task | Saubere Parallelität, keine idle/Make-Work-Falle, Kosten nur bei Arbeit |
| 2026-06-15 | PM wohnt als Persona im Nest | Kleinster Sprung, nutzt Agent-Infra, Codex-nativ |
| 2026-06-15 | Codex-only für autonome Worker+PM | ToC: automatisierter Betrieb nur mit Codex, nicht headless-Claude/Opus |
| 2026-06-15 | Tiering = Modell × reasoning_effort | „Modell allein ist es nicht" — Denk-Tiefe ist der zweite Hebel; Proxy unterstützt effort |
| 2026-06-15 | Claude/Patrick → agent-equivalent | Ziel: kaum noch im Loop; PM treibt, Gewissen wird zugezogen |

## Offene Risiken / Spikes
- **Ephemeres Teardown** ist heute nicht vorhanden — sauberes Abräumen (OS-User/pm2/IdP) ist das Hauptrisiko → M3 ggf. eigener Spike.
- **Spawn-Scope-Auth:** der PM-Agent braucht den `troop:spawn-agent`-Scope in seiner Delegation — prüfen, ob ein Agent diesen Scope bekommen darf (act-Claim-Regeln).
- **Triage-Qualität:** triagiert ein gpt-5.5-high-PM gut genug? M4-Akzeptanz misst es; sonst Triage-Regeln schärfen.

## Session-Checkliste
1. Plan + Progress lesen. 2. M2-Nest läuft separat — nicht kollidieren. 3. Nächsten Milestone. 4. Pro Milestone verifizieren (Container-E2E wo nötig). 5. Progress/Discoveries updaten.

## Progress (2026-06-15)
- [x] M0/M1 reasoning_effort plumbing — MERGED #746
- [x] M2a spawn chain (model+effort → worker env) — MERGED #747
- [x] M2b agent.spawn tool — MERGED #748
- [x] M3 agent.destroy tool (PM-managed ephemeral lifecycle, replaces self-destruct one_shot) — #749 (merging)
- [x] M4 PM-orchestrator RECIPE written (triage+parallel protocol) — committed to agent-catalog repo (8e120be), NOT yet published/registered
- [x] WIRING COMPLETE (2026-06-15): catalog v0.3.0 fetchable on GitHub; **troop redeployed prod-a5b91f47 (was prod-dfb5af61, behind #747)** so reasoning_effort forwards in prod; PM spawned via `POST /api/agents/spawn-intent {bridge_model:gpt-5.5, bridge_reasoning_effort:high, recipe:.../pm-orchestrator@v0.3.0, params:{org_id,org_name}}` → registry persists `{model:gpt-5.5, reasoningEffort:high}`, bridge env confirmed APE_CHAT_BRIDGE_REASONING_EFFORT=high. PM token exchanges OK for BOTH troop:spawn-agent + troop:destroy-agent (scope claims verified). destroy-intent teardown proven.
  - **Discovery A (durable fix):** nest's agent-enroll token had been EXPIRED ~2 weeks; recorded key_path was stale (/tmp/owner-home). Fixed: `apes login <nest-identity> --key /var/lib/openape/nest/.openape/nest/.ssh/id_ed25519` — identity is `nest-openape-nest-cb6bf26a+...` (from config.toml), NOT the stale auth.json email `nest-8d02a3e5455b-...`. Auto-refresh now enabled → nest enrolls agents indefinitely. This path is what the PM uses to spawn workers, so it was a hard blocker.
  - **Discovery B (real gap, not yet fixed):** destroy-intent does LOCAL teardown (OS user, bridge, registry) but does NOT hard-delete the IdP agent identity → name-reuse hits 409. Worked around by `DELETE https://id.openape.ai/api/my-agents/<url-encoded-email>` as owner. Workers use unique names so less impact, but the M3 ephemeral lifecycle should hard-delete IdP on destroy. → follow-up task.
- [ ] LIVE TRIAGE-E2E: needs a real owner backlog (tasks.openape.ai currently 0 open; recipe forbids make-work). PM fires on */10 schedule. Pending: trigger a cycle + watch parallel tiered fan-out.
- [ ] M6 retire the launchd Opus-engine; PM becomes the autonomous driver
