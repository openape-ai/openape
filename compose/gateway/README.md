# LLM Gateway (`llms.openape.ai`) — canonical config

This directory is the version-controlled source of truth for the production LLM
gateway that runs on chatty at `/home/openape/prod-llms/`. Until now that config
was hand-maintained on the box and survived only in the nightly Exoscale SOS
backups. These files are an **exact copy** of the live prod config (Gateway-IaC
**M1** — bring the current state into the repo).

> This is **not** the local dev topology. The dev/local stack lives in
> `compose/docker-compose.yml` (in-process codex-proxy on :4000) and
> `compose/litellm.yaml`. Don't conflate the two.

## What runs here

`docker-compose.yml` defines the gateway stack on the `llms` network:

| Service          | Image                          | Port (host) | Role |
|------------------|--------------------------------|-------------|------|
| `litellm`        | `ghcr.io/berriai/litellm`      | 3012→4000   | OpenAI-compatible router; custom DDISA auth |
| `llm-auth`       | `openape-llm-auth`             | 3015→4010   | DDISA token verification SP (`aud: llms.openape.ai`) |
| `llm-route`      | `openape-llm-route`            | 3016→4020   | M3 path-selector shim `/<owner>/<account>/v1` |
| `codex-proxy-dm` | `openape-llm:codex`            | (internal)  | delta-mind ChatGPT/codex upstream |

- `litellm-config.yaml` — model list (multi-account): `LocalCore-*` via headwai
  is the default group; `delta-mind/*` routes to the codex proxy. `master_key` +
  `custom_auth` = `ddisa_auth.user_api_key_auth`. (lindeverlag retired — M4.)
- `llm-auth/ddisa_auth.py` — the LiteLLM custom-auth callback (per-account model
  allowlist policy). Mounted read-only into the litellm container.
- `llm-route/route.mjs` — strips the `/<owner>/<account>` prefix and namespaces
  the request model per account.

The `openape-llm-auth` / `openape-llm-route` images build from `llm-auth/` and
`llm-route/` here; `openape-llm:codex` builds from `apps/openape-llm/`.

## Secrets

`.env` stays on chatty only (see `.env.example` for the variable names). Nothing
in this directory contains a real secret — every credential is a `${VAR}` /
`os.environ/…` reference.

## Status / next steps

- **M1 (done):** this directory = exact prod config.
- **M2 (done):** `pnpm run deploy:gateway` (`scripts/deploy-gateway.mjs`) — dry-run
  by default; `--deploy` snapshots → syncs → `compose up -d` → health-gate → rollback.
- **M3 (done):** `pnpm run gateway:drift` (`scripts/gateway-drift.mjs`) diffs this
  directory against live chatty.
- **M4 (repo-side done; deploy pending):** `_MODELS` = LocalCore only, `delta-mind`
  its own codex group, `lindeverlag` retired and the default account made ungated
  (`_DEFAULT_ACCOUNT = "default"`). Live cutover is a watched `deploy:gateway --deploy`
  — until then this directory drifts from live (drift guard will flag it).

Full plan: `.claude/plans/gateway-iac.md`.
