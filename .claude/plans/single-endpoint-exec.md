# Exec-Plan — Single-Endpoint: zaz-repoint (=Todo 1) + Flotten-Migration + Alias-Drop

**Kontext:** Fortsetzung von `HANDOFF-llms-single-endpoint.md`. Session 2 hat `codex-proxy.service` (:4001) gekillt. Patrick-Entscheid 2026-06-18: zaz **rebuild+repoint**, gpt-5.x-Aliase via **Flotten-Migration jetzt** droppen.

**Scope-Shift (wichtig):** „zaz repointen mit eigenem Token" ist KEIN Config-Change. Service-Bridge (wie cron-runner) nutzt statischen `LITELLM_API_KEY`; nur die **Chat**-Bridge (`bridge.ts:refreshLlmGatewayKey`) self-exchanged einen DDISA-Token. Also = **Todo 1** (Cron/Service-Pfad → DDISA-Token) als Code-Feature + npm-Release. Damit verschmilzt Todo 1 in diese Arbeit.

---

## M1 — Code: Service+Cron-Pfad self-exchanged DDISA-Token (= Todo 1)
**Datei:** `apps/openape-ape-agent/src/service-bridge.ts` (+ `cron-runner.ts` falls eigener LLM-Pfad).
**Change:** wenn `LITELLM_BASE_URL` `llms.openape.ai` enthält, LLM-`apiKey` per `getAuthorizedBearer({endpoint:origin, aud:host})` (cli-auth) minten+cachen statt statischem Master-Key; resilient (Exchange-Fehler → behalte aktuellen Key), refresh vor jedem Task/Turn. Spiegelt `bridge.ts` exakt.
**TDD:** Test zuerst — `pollOnce`/Config baut bei `llms.openape.ai`-Base den Key via injizierter `getAuthorizedBearer`-Mock, bei loopback bleibt statisch.
**Akzeptanz:** `pnpm lint && pnpm typecheck && pnpm turbo run test --filter=@openape/ape-agent` grün.

## M2 — Release @openape/ape-agent v2.11.0 (lokal)
`pnpm changeset` → `pnpm version-packages` → Branch+PR (main protected) → grünes CI → merge → `pnpm release`.
**Akzeptanz:** `npm view @openape/ape-agent version` = 2.11.0.

### M1+M2 STAND (2026-06-18)
- **M1 DONE:** Shared helper `src/llm-gateway-key.ts` (`resolveLlmGatewayKey`, TDD, injizierbares exchange). bridge.ts refactored darauf; service-bridge.ts + cron-runner.ts refreshen den LLM-Key per Task/Fire (optionaler `refreshApiKey`-Dep). Lint/typecheck/build grün, 94 Tests grün. Dist-Bundle hat jetzt DDISA-exchange + key-reauth (vorher M9-Bundle = 0).
- **M2 IN FLIGHT:** Version manuell auf 2.11.0 (surgical — die 2 pending changesets cli-auth-authhome/recovery-v2 NICHT mit-released). Branch `feat/service-cron-ddisa-token`, 2 Commits, **PR #781** (git.openape.ai/openape-ai/openape/pulls/781), mergeable. CI läuft. Nach grün: merge (squash) → `pnpm release` (npm-Login `patrick-hofmann` da) → publish-chain published nur ape-agent@2.11.0 (Rest schon auf npm).
- **M3 prep:** chatty hat node v22/npm 10 als openape, kein node_modules in zaz-agent → Deploy = `npm i @openape/ape-agent@2.11.0` im zaz-Dir (löst jose, umgeht M9-Bundle-Gotcha), ExecStart auf installierten `ape-agent-service`-Bin. Grant zaz→headwai bei Deploy via Logs verifizieren (401 falls fehlt).

## M3 — zaz rebuild + repoint + resurrect
- Bundle neu (esbuild --bundle, self-contained — M9-Gotcha jose-external) aus v2.11.0 → `/home/openape/zaz-agent/service-bridge-main.mjs` (alte als `.prev`).
- `openape-zaz-agent.service`: `LITELLM_BASE_URL=https://llms.openape.ai/v1`, `APE_SERVICE_MODEL=LocalCore-Instant`, `LITELLM_API_KEY=placeholder` (wird durch DDISA-Token ersetzt), `After=` ohne `codex-proxy.service`.
- zaz-Grant prüfen: `apes grants llm allow zaz headwai` (falls fehlt).
- Restart. zaz key-reauthed IdP (challenge-response, current cli-auth) + self-exchanged llms-Token.
**Akzeptanz (sichtbarer Beweis):** journal zeigt `service-agent zaz-svc-…@id.openape.ai → SP …, LLM https://llms.openape.ai/v1, model LocalCore-Instant`, KEINE „Not logged in"-Loops; eine echte Task läuft completed durch; zaz `sp-tokens/llms.openape.ai.json` existiert + ist echt (`sub: zaz-svc…`, `aud: llms.openape.ai`).

### M2+M3 DONE (2026-06-18)
- **M2 DONE:** PR #781 CI-grün → squash-merged → `pnpm release` → **`@openape/ape-agent@2.11.0` live auf npm** (dry-run + publish bestätigt nur ape-agent; cli-auth/auth/nuxt-auth-idp pending changesets unangetastet).
- **M3 DONE + bewiesen:** zaz auferstanden + repointet.
  - `npm i @openape/ape-agent@2.11.0` in `/home/openape/zaz-agent` (node_modules mit jose → kein M9-Bundle-Gotcha). systemd-Unit (Backup `.bak-repoint`): `ExecStart` → installierter `dist/service-bridge-main.mjs`, `LITELLM_BASE_URL=https://llms.openape.ai/patrick@hofmann.eco/headwai/v1`, `APE_SERVICE_MODEL=LocalCore-Instant`, `After=` ohne codex-proxy.
  - **Grant-Fund:** der SERVICE läuft als `zaz-svc-…@id.openape.ai` (≠ nest-home `zaz-…`, das schon headwai hatte). zaz-svc hatte `accounts=[]` → 401. **Gefixt:** `apes grants llm allow zaz-svc-cb6bf26a+patrick+hofmann_eco@id.openape.ai headwai` (grant `b20acc1d`).
  - **Beweis:** zaz-svc self-exchanged Token `aud=llms.openape.ai, act=agent, accounts=["headwai"]`; headwai-Pfad-Completion → **HTTP 200 `ZAZ-OWN-TOKEN-OK` (headwai/LocalCore-Instant)**. Service bootet sauber, 60s ohne Error/auth-loop (vorher 3 Tage „Not logged in"-Spam alle 1.5s), NRestarts=0. codex-proxy.service inactive/disabled.
- **Todo 1 Status:** Code (service+cron self-exchange) ist in v2.11.0. **Live nur für zaz** (frisch installiert). Die **Nest-Flotte läuft noch 2.10.0** → Chat self-exchanged seit 2.10.0, aber der **Nest-CRON-Pfad nutzt noch den Boot-Master-Key** bis der Nest auf 2.11.0 hochgezogen wird (npm-Install im Container + Bridges respawnen). DAS ist die Voraussetzung für Todo 2/3 (Master-Key-Drop).

## Bridge-Kette 1→2→3 — DONE (2026-06-18, dieselbe Session)
1. **Nest auf ape-agent@2.11.0 (DONE):** `dist/bridge.mjs` (2.11.0, mit cron-self-exchange) per `docker cp` nach `/opt/openape/ape-agent/dist/bridge.mjs` (Backup `.bak-2.10.0`), alle 16 Bridges rolling `pm2 restart --update-env` (Env blieb intakt, 16/16 online, ceo connected). **Durability:** `docker commit openape-nest openape-nest:2.11.0` + Tags `latest`+`openclaw` zeigen drauf (Original openclaw → `openclaw-pre-2.11.0`). Beweis: 16/16 Homes haben gecachten `llms.openape.ai`-sp-token (ceo: accounts=[headwai,delta-mind,lindeverlag], enriched).
2. **Todo 2 (DONE, durable):** `~/.config/openape/nest.env` `LITELLM_API_KEY` → `ddisa-self-exchange-fallback-unused` (Backup `.bak-masterdrop`). Laufender Container behält den alten Master in der Env (nach Todo 3 inert); greift beim nächsten Recreate.
3. **Todo 3 (DONE):** Master-Net in `prod-llms/llm-auth/ddisa_auth.py` entfernt (das `if _MASTER and hmac.compare_digest`-Branch raus; Backup `.bak-masterdrop`), `docker restart llms-litellm`. **Beweis: Master-Key → HTTP 401, DDISA-Token → 200 `DDISA-STILL-OK`.** litellm short-circuited den Master NICHT (custom_auth ist das Gate) → keine Key-Rotation nötig. Fleet 2min: 53×200, 1×401 (=mein Master-Test), 0 collateral. Grace-Branch (Legacy-`accounts=None`) bewusst BEHALTEN (konservativ).

**Follow-ups (2026-06-18, selbe Session) — BEIDE DONE:**
- **Proper Nest-Image-Rebuild DONE:** `docker build -f apps/openape-nest/Dockerfile -t openape-nest:2.11.0-clean .` (arm64, aus main → ape-agent 2.11.0 + openclaw 2026.6.8 + ape-troop + openclaw-adapter, smoke-getestet) → Tags `latest`/`2.11.0`/`openclaw` zeigen jetzt auf den CLEAN build (Original openclaw bleibt `openclaw-pre-2.11.0`; der `docker commit` ist obsolet/dangling). **Prod via `nest-prod.run.sh` blue-green darauf recreatet** (alt = `openape-nest-prev` für Rollback). Beweis: baked ape-agent=2.11.0, running-env `LITELLM_API_KEY=ddisa-self-exchange-fallback-unused` (Todo 2 jetzt LIVE im Container, nicht nur staged), 16/16 Bridges online, ceo reconnected, **Gateway 90s: 36×200, 0×401 → Placeholder-Key-Flotte self-exchanged nachweislich**, openclaw intakt.
- **Master-Key-Rotation DONE:** neuer `sk-openape-llms-<48hex>` in `docker-compose.yml:53` (Backup `.bak-keyrotate`; alter war hardcoded, nicht in .env), `docker compose up -d --no-deps litellm`. Beweis: **alter Master → 401, DDISA → 200 `ROTATE-OK`**. (litellm ist via `Host(llms.openape.ai)`→:3012 am Host-Root erreichbar, daher war der alte Master extern für litellm-Admin nutzbar → Rotation war real wertvoll, nicht nur kosmetisch.)

**Honest naming + Grace-Drop + Tag (2026-06-18, selbe Session) — DONE:**
- **Honest single-endpoint naming (= M4/M5) DONE:** `nest.env` default `gpt-5.5`→`LocalCore-Instant`; `agents.json` 3 gepinnte (email-assistant/pm-orchestrator/dm-ceo) gpt-5.x→`LocalCore-Instant` (Backup `.bak-honestnaming`); Nest blue-green recreatet → 16/16 online, ALLE auf `LocalCore-Instant` (verhaltensneutral: gpt-5.5/5.4 mappten eh auf LocalCore-Instant). Gateway: die 4 default `gpt-5.x`-Alias-Einträge aus `litellm-config.yaml` entfernt (named `delta-mind/`+`lindeverlag/gpt-5.x` 8 Stück BLEIBEN — echte Codex-Modelle; `LocalCore-Instant`+`Thinking` bleiben). Backups `.bak-honestnaming`. **Beweis (ceo-Token, lindeverlag, default `/v1`): `LocalCore-Instant`→200, `gpt-5.5`→400; Gateway 55×200/1×400, 0×401.**
- **Grace-Branch entfernt:** vorher verifiziert 16/16 Homes haben enriched Token (accounts=list, 0 None). `ddisa_auth.py` Legacy-`accounts is None`-Grace → jetzt `raise` (401). Backup `.bak-honestnaming`. 0 401s nach Restart → niemand hing am Grace.
- **`openape-nest:2.11.0-clean`-Tag gedroppt** (redundant). Image-Set jetzt: `2.11.0`/`latest`/`openclaw` (=clean build) + `openclaw-pre-2.11.0`.

**Hygiene-Items (2026-06-18, „beide"):**
- **Master-Key → .env DONE:** rotierter Key aus `docker-compose.yml` nach `prod-llms/.env`; compose referenziert `${LITELLM_MASTER_KEY:?}`. Wert unverändert → kein Recreate nötig. Secret raus aus compose-Plaintext, durable.
- **Repo-Policy-Sync DONE:** `compose/llm-auth/ddisa_auth.py` war nur um meine 3 prod-Änderungen hintendran → Master-Net + Grace gedroppt, Repo == prod. **PR #785 merged** (CI grün). `compose/litellm.yaml` = lokaler Dev-Stub (206B), KEIN prod-Gateway-Mirror → nichts zu syncen; prod `litellm-config.yaml` ist hand-managed ohne Repo-Pendant.
- **`_MODELS`-Trim NICHT gemacht (wäre unsicher!):** `_MODELS` ist geteilt — `delta-mind`/`lindeverlag` fallen mangels `_ACCOUNT_MODELS`-Eintrag auf `_MODELS` zurück, die gpt-5.x-Namen sind dort **load-bearing** für die Codex-Accounts (`delta-mind/gpt-5.5` etc.). Trimmen → Codex-Accounts denied. (Frühere „aufräumbar"-Aussage war falsch.) Sauberer Trim bräuchte erst eigene `_ACCOUNT_MODELS`-Einträge für delta-mind/lindeverlag — Refactor, kein Quick-Win.

- **Deferred (kosmetisch):** M4/M5 Flotten-Rename + gpt-5.x-Alias-Drop (Patrick-Entscheid: später; Flotte läuft eh headwai-Instant via Alias).

## M4 — Flotten-Migration auf Real-Namen (Nest, Mac mini) [DEFERRED]
- `~/.config/openape/nest.env`: `APE_CHAT_BRIDGE_MODEL=gpt-5.5` → `LocalCore-Instant` (durable default).
- Per-Agent-Recipe-Modelle auf Real-Namen (reasoning: `LocalCore-Thinking` für coder/backend/qa/pm-orchestrator; sonst `LocalCore-Instant`). Quelle der durable per-agent models lokalisieren (recipe `model:` vs troop) — TODO im Lauf.
- Nest recreaten (blue-green via `compose/nest-prod.run.sh`, Rollback im Script) ODER per-bridge pm2-env + restart.
**Akzeptanz:** alle 16 Bridges online, je auf Real-Namen gebootet (logs); eine Chat-Completion pro Klasse grün.

## M5 — Verify 0× gpt-5.x, dann Aliase droppen
- Gateway-Logs ≥30min beobachten: `gpt-5.5/5.4/5.4-mini/5.3-codex` = 0 Hits, nur `LocalCore-*`.
- `litellm-config.yaml`: die 4 default `gpt-5.x`-Einträge entfernen (Backup vorher). litellm reload (`docker compose up -d` für den Service, oder container restart). 
- **Akzeptanz:** `gpt-5.5` → 400 „model not found"; `LocalCore-Instant` → 200; Flotte+zaz unbeeinträchtigt (Completion-Beweis).

## Danach (separat, nicht dieser Plan): Todo 2/3 Master-Key-Drop
M1 macht Service+Cron DDISA-fähig → Master-Key-Fallback in nest-env (`LITELLM_API_KEY`) + Gateway-Admin-Net droppen wird möglich. Eigene Session.

---
**Reihenfolge/Abhängigkeit:** M1→M2→M3 (zaz). M4 unabhängig von M1-3 (reine Config), aber M5 (Alias-Drop) braucht BEIDE M3 (zaz off gpt-5.5) UND M4 (Flotte off gpt-5.5). Git-Checkpoints pro Milestone. Jede Live-Mutation: erst Stand prüfen, Backup, dann Beweis.
