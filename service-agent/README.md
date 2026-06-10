# service-agent

A generic [OpenApe](https://openape.ai) agent **recipe**: a Nest-managed worker that pulls
tasks from *any* service provider's (SP) A2A task queue, solves each via the Nest LLM, and
posts the result back. No per-SP code — an SP onboards in one line.

## Deploy

```sh
apes agent deploy openape-ai/service-agent@v0.1.0 \
  --param sp_base_url=https://zaz.delta-mind.at
```

Optional `--param model=gpt-5.5` (default `gpt-5.5`).

The deploy spawns a normal `kind: agent` Nest agent (own OS user, DDISA identity,
pm2-supervised). Its cron schedule runs `tools/serve.mjs` once a minute; each run polls the
SP for ~50 s, draining tasks as they arrive.

## SP contract

The SP exposes two agent-authenticated routes (see `@openape/sp-tasks`):

- `POST {sp}/api/agent/tasks/next` → `{ task }` — atomic lease of the next task, or `null`.
- `POST {sp}/api/agent/tasks/resolve` `{ id, state, artifact }` — report progress / done / error.

A task's `history[0]` carries a `data` part `{ systemPrompt, userMessage, model? }`; the worker
runs that as one chat completion and resolves the task `completed` with the answer (or `failed`
with the error). Add the agent's DDISA email to the SP's allowlist so its bearer is accepted.

## How `serve.mjs` authenticates

Dependency-free. It reads the agent's DDISA bearer from `~/.config/apes/auth.json` (kept fresh
by the running bridge) and the LLM endpoint from `LITELLM_BASE_URL` in the environment.

Multiple agents can serve one SP queue safely — the lease is atomic (each task is delivered
once), so throughput scales with the number of agents.
