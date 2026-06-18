> **UPDATE 2026-06-18 (Session 3) — DDISA-only erreicht.** codex-proxy.service gekillt; ape-agent **v2.11.0** (service+cron DDISA-self-exchange = **Todo 1**); **zaz auferstanden + repointet**; **Nest-Flotte auf 2.11.0** (16/16, cron self-exchange); **Todo 2** (nest.env Master→Placeholder) + **Todo 3** (Gateway-Master-Net entfernt) → **Master-Key→401, DDISA→200**. Nur Todo 4 (codex-proxy) + die Master-Kette sind erledigt; **M4/M5 (gpt-5.x-Alias-Drop) bleiben bewusst deferred (kosmetisch)**. Voller Stand + Loose-Ends: `single-endpoint-exec.md`.

# HANDOFF — Single-Endpoint LLM Migration (headwai + DDISA-only)

**Quelle:** Session `e1e9249e-fab3-4a59-bc72-0c3fd4bd0929` (2026-06-17, 12:38–17:32).
**Stand:** Migration zur Hälfte erledigt & live; Rest ist Legacy-Cleanup. Letzte offene Frage an Patrick: „Womit anfangen?" (siehe **Nächster Schritt**).

---

## Worum es geht

Patricks Ziel (Originalwortlaut): *„Wir haben viel Legacy angestaut … wir haben nun das `llms.openape.ai` und brauchen keine anderen Proxies oder Nest-Verschränkungen. Die Agents werden auf einen OpenAI-kompatiblen Endpunkt geleitet und haben ihren llms-Token als Bearer um sich zu authentifizieren. Alles andere ist Legacy."*

Dazu kam in derselben Session ein konkreter Auslöser: die delta-mind-ChatGPT-Sub war **exhausted (HTTP 429 `usage_limit_reached`)** → Flotte konnte nicht „weiterarbeiten". Fix = neuer self-hosted Provider **headwai**.

---

## ✅ Was in dieser Session erledigt & LIVE bewiesen wurde

### 1. headwai als Sub-Provider am Gateway (`llms.openape.ai`, auf chatty)
- Upstream: `https://iurio-prod.my-ki.at/api/v1` (vLLM, Bearer-Auth), Modelle **`LocalCore-Instant`** + **`LocalCore-Thinking`**. Key aus `~/headwai.key` → `/home/openape/prod-llms/.env` als `HEADWAI_API_KEY` (per stdin, nie geloggt).
- `litellm-config.yaml`: named account `headwai/LocalCore-Instant` + `headwai/LocalCore-Thinking` ergänzt.
- `ddisa_auth.py`: Policy auf **per-Account-Modelle** umgestellt (self-check grün).
- Beweis über öffentliche Edge: `/patrick@hofmann.eco/headwai/v1` `LocalCore-Thinking` → HTTP 200.

### 2. Default-Gruppe auf headwai geflippt
- Die 4 Default-Namen `gpt-5.5/5.4/5.4-mini/5.3-codex` → alle auf `LocalCore-Instant @ headwai`. Flotte hittet Default-`/v1` mit `gpt-5.x` → automatisch headwai, **ohne** mbp-home-Änderung. Beweis: `/v1 gpt-5.5` → HTTP 200 `FLEET-ON-HEADWAI` (vllm fingerprint).
- Named `delta-mind/*` **unangetastet** → weiter Codex (429, exhausted).

### 3. Alle 17 Agents auf headwai gegrantet
- `apes grants llm allow <agent> headwai`. Owner-Token trägt jetzt `accounts:[headwai, delta-mind, lindeverlag]`.

### 4. Fleet explizit auf echte Modellnamen gebunden
- Die 16 Bridges im **`openape-nest` OrbStack-Container (= der mbp-home Nest, läuft auf dem Mac mini)**: `coder/backend/qa/pm-orchestrator` → **LocalCore-Thinking**, die anderen 12 → **LocalCore-Instant**. Per-bridge pm2-env, alle online, auf dem richtigen Modell gebootet. Logs sauber.
  - ⚠️ **Nicht durable:** diese pm2-env-Settings überleben einen Bridge/Nest-Respawn nicht (fallen auf Instant via `gpt-5.5`-Alias zurück) — nicht kaputt, aber nicht persistent.

### 5. KERN bereits gebaut UND deployed (die große Überraschung)
- `@openape/ape-agent` **v2.10.0** läuft im Container (`/opt/openape/ape-agent/dist/bridge.mjs`). Diese Version **mintet+refresht per-Agent-DDISA-Tokens selbst** (`refreshLlmGatewayKey` → `getAuthorizedBearer`, ~7 min TTL, per Chat-Turn).
- Bewiesen: jede Home (ceo/coder/zaz) hat gecachten `sp-tokens/llms.openape.ai.json`; ceo's Token ist echt (`sub: ceo-…@id.openape.ai`, `aud: llms.openape.ai`, `act: agent`, `accounts:[headwai,delta-mind,lindeverlag]`), alle um 16:38 refresht.
- Das **v2.8.10**, das anfangs gesehen wurde, war nur die Mac-mini-**Host**-CLI, nicht die Flotte. → **Agents authentifizieren sich auf Chat-Turns schon mit ihrem EIGENEN Token.**

> Heißt: Patricks Vision („Agents nutzen ihren eigenen llms-Token") ist für den Chat-Pfad **bereits Realität**. Was bleibt, ist Legacy-Fallback entfernen.

---

## 🔲 Was noch TODO ist (der Cleanup)

Der deployte v2.10.0-Code dokumentiert den Rest selbst:
> `// cron keeps the boot key, chat threads pick up the refreshed token — drop master_key + cron-DDISA later.`

| # | Todo | Wo | Risk | Unblockt |
|---|------|----|------|----------|
| 1 | **Cron-Pfad → DDISA-Token** (nutzt noch den Boot-Master-Key) | `ape-agent` `cron-runner`/`bridge.ts` → release + redeploy | mittel (Code+Release) | Master-Key droppen |
| 2 | **`LITELLM_API_KEY`=master nicht mehr in Bridges injecten** | nest-env / `compose` | niedrig | — |
| 3 | **Master-Key-Admin-Net am Gateway droppen** | `ddisa_auth.py` (prod-llms) | niedrig | full DDISA-only |
| 4 | **`zaz` → Gateway repointen** (eigener Token), dann **`codex-proxy.service` killen** (:4001, noch `active` auf chatty) | zaz-config + systemd | mittel | letzter Standalone-Proxy weg |
| 5 | **Gateway-Tidy**: `gpt-5.x`-Aliase droppen, Compose-Drift abgleichen, toten in-nest `127.0.0.1:4000`-Loopback raus | litellm-config / compose | niedrig | sauberer Single-Endpoint |

**Sequencing:** **1 muss vor 2→3** (Master-Key ist aktuell der Fallback falls ein Exchange scheitert — darf nicht weg solange Cron drauf angewiesen ist). **4 und 5 sind unabhängig**, jederzeit machbar.

**Patricks Scope-Entscheid in der Session:** „Alles in einem" (volle Single-Endpoint-Migration). Codex **bleibt** als Gateway-Account (`codex-proxy`/`codex-proxy-dm`-Container bleiben Upstreams für `delta-mind`/`lindeverlag`); nur der **standalone** `codex-proxy.service` (:4001) und die Master-Key-Verschränkung gehen.

---

## Nächster Schritt (hier wurde gestoppt)

Letzte Assistant-Frage war: *„Want me to start? 4 + 5 jetzt (unabhängig, low-risk, sofortige Legacy-Entfernung), und 1→2→3 als die eine Bridge-Release-Kette behandeln. Womit zuerst?"* → **Patrick hat noch nicht geantwortet.** Neue Session: diese Frage stellen bzw. mit 4+5 starten wenn er freie Hand gibt.

---

## Session 2 (2026-06-18) — codex-proxy.service gekillt + Recon korrigiert die Risiko-Einschätzung

**DONE & bewiesen:**
- **`codex-proxy.service` (:4001) gestoppt + disabled** (`/etc/systemd/system/multi-user.target.wants/codex-proxy.service` entfernt; Unit-File bleibt für Rollback: `sudo systemctl enable --now codex-proxy.service`). `:4001` weg. Gateway-readiness 200, beide `llms-codex-proxy*`-Container (=Gateway-Upstreams, bleiben) healthy. Post-kill `gpt-5.5`-Completion über Gateway → HTTP 200, `POSTKILL-OK` (vllm-fingerprint → headwai). Sicher, weil der **einzige** :4001-Consumer tot ist (siehe unten).

**Recon-Funde, die die Handoff-Tabelle widerlegen (Todo 4+5 sind NICHT „unabhängig low-risk"):**
- **zaz-agent ist seit 3 Tagen tot.** `openape-zaz-agent.service` crash-loopt seit 15.6. mit `IdP token expired … no refresh_token is stored. Run apes login`. Der Bundle (`/home/openape/zaz-agent/service-bridge-main.mjs`, M9-Vintage 2026-06-09) kann **kein** DDISA-Self-Exchange (`getAuthorizedBearer`-Count = 0) — anders als ape-agent v2.10.0. Er nutzt `LITELLM_API_KEY` statisch und zeigte auf `:4001` (`LITELLM_API_KEY=unused-codex-proxy-ignores-it`). → **„zaz auf Gateway repointen mit eigenem Token" wie spezifiziert geht nicht ohne Bundle-Rebuild** (aus v2.10.0, das self-exchanged). zaz hat DDISA-Identität (`config.toml`: `zaz-svc-cb6bf26a+…@id.openape.ai`, key-file da). **ENTSCHEIDUNG nötig: zaz stilllegen (3 Tage tot, keiner hats gemerkt) oder Bundle neu bauen+repointen?** zaz ist ein Delta-Mind-Produkt (`zaz.service` Nuxt-App läuft separat) → Produktentscheid, nicht still entscheiden.
- **gpt-5.x-Aliase droppen ist NICHT unabhängig — sie tragen die Live-Flotte.** Gateway-Traffic 24h: **gpt-5.5 ×110**, gpt-5.4 ×12, gpt-5.4-mini ×12, gpt-5.3-codex ×12, LocalCore-Thinking ×6, LocalCore-Instant ×6. Der durable Nest-Default ist die `gpt-5.5`-Alias (in `~/.config/openape/nest.env` auf dem Mac mini: `APE_CHAT_BRIDGE_MODEL=gpt-5.5`; der laufende Container ebenso). Die per-bridge Real-Namen-Bindung aus Session 1 §4 hat sich offensichtlich NICHT durchgesetzt (Respawns fielen auf `gpt-5.5` zurück). → **Alias-Drop = Flotten-Migration, kein Tidy.** Reihenfolge: (1) `nest.env` `APE_CHAT_BRIDGE_MODEL`→`LocalCore-Instant` + Nest recreaten, (2) per-Agent-Recipe-Modelle auf Real-Namen, (3) Gateway-Logs auf 0× gpt-5.x verifizieren, (4) DANN Aliase droppen. zaz' `APE_SERVICE_MODEL=gpt-5.5` hängt mit dran.
- **„toter in-nest 127.0.0.1:4000-Loopback":** im Live-Nest läuft `codex-proxy/dist/bin.js` (PID 145) — **ohne Credential** (`/var/lib/openape/codex/` leer), **ohne Listener** (kein :4000), serviert nichts. Reines Dead-Weight, **keine** Cross-Invalidation-Gefahr. Entfernen = Nest-Entrypoint/Image-Change + Blue-Green-Redeploy (nicht der „config tweak", den die Tabelle suggeriert). Geringer Nutzen.
- **„Compose-Drift abgleichen":** `compose/docker-compose.yml` ist die **lokale Dev-Topologie** (in-process codex-proxy auf loopback:4000, kein externer Gateway) — absichtlich verschieden vom Prod-Nest (der via `compose/nest-prod.run.sh` + `~/.config/openape/nest.env` den externen Gateway nutzt). Kein Bug, nichts zu „fixen"; die Divergenz ist im run.sh-Kommentar dokumentiert.

**Fazit:** Von Todo 4+5 war nur der codex-proxy.service-Kill wirklich sicher+unabhängig (erledigt). Rest ist entweder entscheidungs-gated (zaz) oder gekoppelt/Migration (Alias-Drop) oder Image-Rebuild (in-nest Loopback). Bridge-Kette 1→2→3 (Master-Key) unberührt.

---

## Schlüssel-Fakten / Pfade (für die nächste Session)

- **Gateway-Box:** `ssh ubuntu@chatty.delta-mind.at`, sudo nur als `ubuntu`. Gateway-Dir: `/home/openape/prod-llms/` (`docker-compose.yml`, `litellm-config.yaml`, `.env`, `llm-auth/ddisa_auth.py` + `server.mjs`, `llm-route/route.mjs`). litellm-Container `llms-litellm`, readiness `http://127.0.0.1:3012/health/readiness`. Master-Key: `sk-openape-llms-…` (in `.env`).
- **Fleet/Nest:** `openape-nest` **OrbStack**-Container auf dem **Mac mini** (= mbp-home Nest). 16 Homes unter `/var/lib/openape/homes/<agent>`, Bridges = pm2 `openape-bridge-<home>` (laufen als User `<home>`). `docker exec openape-nest …`. mbp-home ist **nicht** per SSH erreichbar — alles über `docker exec` lokal.
- **Nest-Env:** Modell = `APE_CHAT_BRIDGE_MODEL`, Gateway = `LITELLM_BASE_URL` (`https://llms.openape.ai/v1`). Im Linux-Container ist `loadBridgeEnvFile` ein no-op (macOS-Pfad) → Modell kommt nur aus pm2-ecosystem-env. **Config-Drift:** laufender Container ≠ Repo-`compose/.env` (`127.0.0.1:4000/v1`, `gpt-5.4`) → naives `compose up` bricht die Flotte.
- **ape-agent Source:** `openape-monorepo/apps/openape-ape-agent/`. npm latest = v2.10.0. Container installiert v2.10.0 unter `/usr/local/lib/node_modules/@openape/ape-agent` (Symlink) bzw. `/opt/openape/ape-agent/dist/bridge.mjs`. cron-vs-chat-Auth-Block ~Zeile 5868 in der dist.
- **cli-auth:** `getAuthorizedBearer({ endpoint, aud })` macht refresh+exchange+cache — genau das, was Cron auch braucht (Todo 1).
- **npm-Publish = LOKAL** (`pnpm release`), `main` protected → Version-Bump via PR. Kein CI-Release.

## Memory-Bezug
Verwandt: `project_chatty_codex_proxy_m9.md`, `reference_llm_gateway_multiaccount.md`, `reference_local_stack_agent_lifecycle.md`, `project_codex_one_holder_per_account.md`. Nach Abschluss `reference_llm_gateway_multiaccount.md` um headwai + DDISA-only updaten.
