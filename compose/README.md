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
curl http://127.0.0.1:4001/health/liveliness         # → "I'm alive!"
docker logs openape-nest | grep "reconciled with registry"   # → present within 5s
```

## Layout

| Service       | Port (host)  | Port (pod) | Purpose                                  |
|---------------|--------------|------------|------------------------------------------|
| `openape-nest`| —            | —          | Outbound-only WS client to troop; no HTTP API. Health = container Up + "reconciled with registry" in logs. |
| `openape-llm` | 4001         | 4000       | LiteLLM proxy — all model traffic        |

In-pod, services reach each other by their compose service-name
(`http://openape-llm:4000/v1`). On the host the proxy is published to
`127.0.0.1:4001` only — `4001` (not `4000`) so a host-side litellm
install bound to `*:4000` keeps its loopback traffic. On macOS/OrbStack
the specific `127.0.0.1` docker binding wins over the host process's
wildcard `*:4000`, silently stealing requests otherwise.

## Volumes

- `openape-nest-data` → `/var/lib/openape/nest` (registry + auth.json,
  survives `docker compose down`)
- `openape-homes`     → `/var/lib/openape/homes` (per-agent home dirs)

To reset state: `docker compose -f compose/docker-compose.yml down -v`.

## Hatching a cloud instance

The same compose file runs on an Exoscale (or any cloud) Linux VM —
the cloud-provider adapter (Milestone H) `scp`s the image + this file
+ `litellm.yaml` to the VM and runs `docker compose up -d`.
