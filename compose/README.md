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
curl http://127.0.0.1:9091/health             # → 200 OK
curl http://127.0.0.1:4000/health/liveliness  # → 200 OK
```

## Layout

| Service       | Port (host)  | Port (pod) | Purpose                                  |
|---------------|--------------|------------|------------------------------------------|
| `openape-nest`| 9091         | 9091       | Supervises agents, talks to troop SP     |
| `openape-llm` | 4000         | 4000       | LiteLLM proxy — all model traffic        |

In-pod, services reach each other by their compose service-name
(`http://openape-llm:4000/v1`). On the host they're published to
`127.0.0.1` only — a misconfigured firewall can't expose them to the LAN.

## Volumes

- `openape-nest-data` → `/var/lib/openape/nest` (registry + auth.json,
  survives `docker compose down`)
- `openape-homes`     → `/var/lib/openape/homes` (per-agent home dirs)

To reset state: `docker compose -f compose/docker-compose.yml down -v`.

## Hatching a cloud instance

The same compose file runs on an Exoscale (or any cloud) Linux VM —
the cloud-provider adapter (Milestone H) `scp`s the image + this file
+ `litellm.yaml` to the VM and runs `docker compose up -d`.
