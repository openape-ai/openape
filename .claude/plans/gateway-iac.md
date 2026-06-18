# Plan — LLM-Gateway in Version Control / reproduzierbarer Deploy (IaC)

**Status:** PROPOSED (2026-06-18). Aufgedeckt beim Single-Endpoint-Effort (`single-endpoint-exec.md`).

## Problem
Der LLM-Gateway (`llms.openape.ai`) auf chatty unter `/home/openape/prod-llms/` wird **handgepflegt** — kein Repo-Source, kein reproduzierbarer Deploy. Wenn chatty stirbt, lebt die Gateway-Config nur in den nightly-Backups (Exoscale SOS), nicht im git.

Konkret nicht/teilweise in VC:
- `prod-llms/docker-compose.yml` — NICHT im Repo (das Repo-`compose/docker-compose.yml` ist die lokale Dev-Topologie, in-process codex-proxy auf :4000, ≠ prod).
- `prod-llms/litellm-config.yaml` (multi-account: headwai default, delta-mind/lindeverlag codex, LocalCore) — KEIN Repo-Pendant (`compose/litellm.yaml` ist ein 206-B-Dev-Stub).
- `prod-llms/llm-auth/ddisa_auth.py` — jetzt nach `compose/llm-auth/ddisa_auth.py` gespiegelt (Referenz, NICHT Deploy-Quelle), driftet leicht (Kommentare/Self-Check).
- `prod-llms/llm-route/route.mjs` + Dockerfile — Repo `compose/llm-route/` existiert (Stand prüfen).
- `prod-llms/.env` — Secrets (SESSION_SECRET, HEADWAI_API_KEY, LITELLM_MASTER_KEY) — bleiben out-of-repo (korrekt), aber `.env.example` fehlt.

## Ziel
Eine versionierte, reproduzierbare Gateway-Definition + Deploy-Script, sodass der Gateway aus dem Repo neu aufgesetzt/aktualisiert werden kann (analog `scripts/deploy-image.mjs` für die Web-Apps).

## Milestones
- **M1 — Ist-Stand ins Repo holen:** ✅ DONE (PR #791, 2026-06-18). Prod `docker-compose.yml` + `litellm-config.yaml` + `llm-auth/` + `llm-route/` nach `compose/gateway/` gezogen, diff=0 gegen chatty per md5 verifiziert (alle 8 Dateien). `.env.example` (nur Variablennamen) + `README.md` (Stack-Übersicht + M2–M4-Todos) ergänzt. Keine Secrets (alles `${VAR}`/`os.environ`-Refs; `.env`, `codex/`, `codex-dm/` ausgeschlossen). `compose/` ist kein pnpm-Workspace-Glob → keine Build-Auswirkung.
- **M2 — Deploy-Script:** ✅ DONE (PR #795, 2026-06-18). `scripts/deploy-gateway.mjs` (`pnpm run deploy:gateway`): **dry-run ist Default** (zeigt md5-Diff repo↔live, schreibt nichts), echtes Anfassen nur mit `--deploy`. `--deploy` = Pre-Deploy-Snapshot (`.iac-backups/<ts>/`) → tar-sync der 8 getrackten Files (explizite Liste, kein `--delete`, `.env`/`codex*`/`build` unangetastet) → `docker compose up -d` → Health-Gate (`127.0.0.1:3012/health/readiness` == 200, 20×3s) → bei Fehler Rollback auf Snapshot + exit 1. **Dry-run + Diff-Pfad live verifiziert** (in-sync „nothing to deploy"; künstliche Änderung → gelistet, nichts geschrieben, Remote unangetastet). **Der `--deploy`-Live-Pfad (snapshot/sync/up/health/rollback) ist noch nie scharf gelaufen** — erster Cutover bewusst als überwachter manueller Run (Single-Point-Gateway). DDISA-Completion-Smoke (vs. nur readiness) als optionale Härtung offen.
- **M3 — Drift-Guard:** ✅ DONE (PR #793, 2026-06-18). `scripts/gateway-drift.mjs` (`pnpm run gateway:drift`) md5't die 8 getrackten Files lokal + per ssh gegen chatty, exit 0/1/2. Read-only, kein Secret-Check. Beidseitig verifiziert (in-sync exit 0; künstliche Drift → exit 1). Noch nicht in CI verdrahtet (chatty-ssh nötig) — als Pre-Deploy-/On-demand-Check gedacht.
- **M4 — `_MODELS`-Entkopplung + lindeverlag stilllegen** (gefaltet aus #3, **Patrick-Entscheid 2026-06-18: stilllegen**):
  - `delta-mind` bekommt einen eigenen `_ACCOUNT_MODELS`-Eintrag (echte Codex-Modelle gpt-5.x), dann `_MODELS` = nur `LocalCore-Instant/Thinking`.
  - **lindeverlag stilllegen:** `_DEFAULT_ACCOUNT` von `"lindeverlag"` → neutraler Name (z.B. `"default"`/`"headwai"`) — load-bearing Default-Label, daher mit ALLEN Referenzen ändern (`ddisa_auth.py`, llm-route `DEFAULT_ACCOUNT`-env, Edge-Regex falls nötig). Tote `lindeverlag/gpt-5.x`-Einträge aus `litellm-config.yaml` raus; `llms-codex-proxy`-Container (lindeverlag-Upstream) abbauen, falls ungenutzt.
  - Self-Check (`__main__`) anpassen. **Verhaltens-erhaltend verifizieren**: Default-Pfad (`/v1`→LocalCore) + delta-mind unverändert; lindeverlag-Pfad entfällt bewusst (Account gestoppt). Completion-Beweis je verbleibendem Account.
  - Reaktivierung (falls lindeverlag-Codex je zurückkommt) = additiver neuer Account, kein Default-Label → sauberer Zustand.

## Akzeptanz
- `compose/gateway/` enthält die EXAKTE Prod-Config (diff gegen chatty = 0).
- `pnpm run deploy:gateway` kann den Gateway aus dem Repo aktualisieren + bei Health-Fail zurückrollen, ohne Secrets anzufassen.
- M4: `python3 ddisa_auth.py` Self-Check grün; Default-Pfad + delta-mind unverändert (Completion-Beweis); lindeverlag bewusst entfernt (Default-Label umbenannt).

## Risiko/Hinweise
- Secrets NIEMALS ins Repo (`.env` bleibt chatty-only; nur `.env.example`).
- Der Gateway ist Single-Point — Deploy-Script braucht echtes Health-Gate + Rollback (wie die Web-App-Pipeline), kein naives `compose up` (Config-Drift-Falle, s. Single-Endpoint-Handover).
- M4 ist die einzige verhaltensnahe Änderung; M1–M3 sind reine Codifizierung (kein Funktionswechsel).
