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
- **M1 — Ist-Stand ins Repo holen:** prod `docker-compose.yml` + `litellm-config.yaml` (+ `llm-route/`, `llm-auth/`) als kanonische Quelle nach `compose/gateway/` (neues Verzeichnis, klar getrennt vom lokal-dev `compose/docker-compose.yml`). `.env.example` mit den Variablennamen (ohne Werte). Live↔Repo einmal exakt abgleichen (diff = 0).
- **M2 — Deploy-Script:** `scripts/deploy-gateway.mjs` (oder `pnpm run deploy:gateway`) — rsync/scp `compose/gateway/*` → chatty `/home/openape/prod-llms/`, dann `docker compose up -d`, Health-Gate (`/health/readiness` 200 + ein DDISA-Completion-Smoke), Rollback auf vorherige Config bei Fehler. Secrets bleiben auf chatty (`.env` nicht überschreiben).
- **M3 — Drift-Guard:** CI- oder Pre-Deploy-Check, der Repo-`compose/gateway/` gegen live chatty difft und bei Abweichung warnt (verhindert erneutes Auseinanderlaufen).
- **M4 (gefaltet aus „#3 _MODELS-Kopplung"):** `ddisa_auth.py` `_MODELS` entkoppeln — `delta-mind`/`lindeverlag` eigene `_ACCOUNT_MODELS`-Einträge (ihre echten Codex-Modelle gpt-5.x) geben, dann `_MODELS` = nur `LocalCore-Instant/Thinking` (Default/headwai). Self-Check (`__main__`) entsprechend anpassen. **Verhaltens-erhaltend verifizieren** (delta-mind/lindeverlag-Allowlist unverändert), da sonst Codex-Accounts brechen.

## Akzeptanz
- `compose/gateway/` enthält die EXAKTE Prod-Config (diff gegen chatty = 0).
- `pnpm run deploy:gateway` kann den Gateway aus dem Repo aktualisieren + bei Health-Fail zurückrollen, ohne Secrets anzufassen.
- M4: `python3 ddisa_auth.py` Self-Check grün; live delta-mind/lindeverlag + Default unverändert (Completion-Beweis je Account).

## Risiko/Hinweise
- Secrets NIEMALS ins Repo (`.env` bleibt chatty-only; nur `.env.example`).
- Der Gateway ist Single-Point — Deploy-Script braucht echtes Health-Gate + Rollback (wie die Web-App-Pipeline), kein naives `compose up` (Config-Drift-Falle, s. Single-Endpoint-Handover).
- M4 ist die einzige verhaltensnahe Änderung; M1–M3 sind reine Codifizierung (kein Funktionswechsel).
