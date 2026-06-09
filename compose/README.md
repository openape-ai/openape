# OpenApe pod — compose

The two long-running services (`openape-nest` + `openape-llm`) packaged
as containers. Same image runs on OrbStack (Mac), Docker Engine
(Linux), or any Docker-API-compatible host (cloud VMs).

## Quickstart

```bash
# From the monorepo root:
cp apps/openape-llm/config.example.yaml compose/litellm.yaml
cp compose/.env.example compose/.env
# ↑ Edit compose/.env, fill ANTHROPIC_API_KEY / CHATGPT_OAUTH_TOKEN.

docker compose -f compose/docker-compose.yml up --build

# Verify (in another shell):
docker ps                                            # both Up
curl http://127.0.0.1:4000/health/liveliness         # → "I'm alive!"
docker logs openape-nest | grep "reconciled with registry"   # → present within 5s
```

## Layout

| Service       | Port (host)  | Port (pod) | Purpose                                  |
|---------------|--------------|------------|------------------------------------------|
| `openape-nest`| —            | —          | Outbound-only WS client to troop; no HTTP API. Health = container Up + "reconciled with registry" in logs. |
| `openape-llm` | 4000         | 4000       | LiteLLM proxy — all model traffic        |

In-pod, services reach each other by their compose service-name
(`http://openape-llm:4000/v1`). On the host they're published to
`127.0.0.1` only — a misconfigured firewall can't expose them to the LAN.

## Volumes

- `openape-nest-data` → `/var/lib/openape/nest` (registry + auth.json,
  survives `docker compose down`)
- `openape-homes`     → `/var/lib/openape/homes` (per-agent home dirs)

To reset state: `docker compose -f compose/docker-compose.yml down -v`.

## Developing a recipe locally

Iterate on an agent recipe's `tools/` (e.g. `tools/serve.mjs`) without the
publish → `apes agent deploy` → sync round-trip. Bind-mount your local recipe
checkout into the nest and point the cron runner at it — add to the
`openape-nest` service (e.g. a `compose/docker-compose.override.yml`, or the
equivalent `docker run` flags):

```yaml
services:
  openape-nest:
    volumes:
      - /abs/path/to/your-recipe:/opt/recipe-dev:ro
    environment:
      OPENAPE_RECIPE_DEV_DIR: /opt/recipe-dev
```

`OPENAPE_RECIPE_DEV_DIR` overrides the synced `~/recipe` for scheduled
`command` tasks: the in-bridge cron runner runs them with that dir as cwd, so
an edit to your local `tools/serve.mjs` lands on the next 60s tick — no git
push, retag, redeploy, or sync.

Caveats:
- Deploy the recipe once first so the agent has its `command` schedule; the
  mount only swaps *where* `tools/` resolves, not the schedule itself.
- Mount the recipe repo root (the dir that contains `tools/`).
- It's global — every command-running agent uses this dir, so develop one
  recipe at a time. Remove it (and recreate the container) to return to the
  synced checkout.

## Hatching a cloud instance

The same compose file runs on an Exoscale (or any cloud) Linux VM —
the cloud-provider adapter (Milestone H) `scp`s the image + this file
+ `litellm.yaml` to the VM and runs `docker compose up -d`.
