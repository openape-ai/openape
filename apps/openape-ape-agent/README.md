# `@openape/ape-agent`

The OpenApe agent runtime. One process per spawned agent. Hosts the LLM
loop (tools + per-thread memory + cron tasks) and proxies chat messages
to/from `chat.openape.ai` on the agent's behalf.

Renamed from `@openape/chat-bridge` in v2.0.0 — the old name was an
implementation leak ("bridge" suggested a dumb pipe, but the package
hosts the whole agent runtime). The `openape-chat-bridge` binary still
ships as an alias so existing pm2 ecosystem.config.js files keep working.

## Install

```bash
npm i -g @openape/ape-agent
```

The default `apes agents spawn` workflow expects `ape-agent`, `apes`,
and `node` on PATH — install them globally on the host once, not per
agent. Pass `--no-bridge` if you only want an IdP/troop account
without the chat runtime (headless / CI use cases).

## What it does

- WebSocket-connect to `chat.openape.ai` as the agent identity
  (token from `~/.config/apes/auth.json`)
- For each inbound message, open or reuse a `ThreadSession`
- The session runs `runLoop` from `@openape/apes`:
  - Sends `messages + tools[] + tool_choice: 'auto'` to the LiteLLM proxy
  - Executes `tool_calls` locally (time, http, file, tasks, mail …)
  - Streams text deltas back by PATCHing the chat placeholder message
- Cron tasks (`agent.json.tasks[]`) fire on schedule through the
  same loop, no per-turn user message

Tools and system prompt are read from `~/.openape/agent/agent.json`,
written by `apes agents sync` from `troop.openape.ai`. Owner-side edits
in the troop UI take effect on the next sync, no restart needed.

## Configuration (`~/Library/Application Support/openape/bridge/.env`)

Written by `apes agents spawn` (unless `--no-bridge`). Required:

| Variable | Purpose |
|---|---|
| `LITELLM_API_KEY` | Master key for the local LiteLLM proxy |
| `LITELLM_BASE_URL` | Default: `http://127.0.0.1:4000/v1` |
| `APE_CHAT_BRIDGE_MODEL` | Model name as the proxy knows it (e.g. `gpt-5.4`) |

Optional:

| Variable | Purpose |
|---|---|
| `APE_CHAT_BRIDGE_MAX_STEPS` | Per-turn step cap (default 10) |
| `APE_CHAT_BRIDGE_ROOM` | Restrict to a single room (default: all) |
| `APE_CHAT_BRIDGE_SYSTEM_PROMPT` | Fallback when `agent.json` lacks one |
| `OPENAPE_OWNER_EMAIL` | Defense-in-depth owner identity |

## Logs

pm2 puts them under the agent user's `~/.pm2/logs/`. Boot line:

```
bridge starting — agent=<email> owner=<email> apes=<bin> model=<m> tools=[<...>] max_steps=<n> room=<filter>
```

Per-turn:

```
[<room>/<thread>] in: <user message>
[<room>/<thread>] tool_call: time.now
[<room>/<thread>] tool_result: time.now
```

No `tool_call` log line on a "Wie spät ist es?" turn is the canonical
fingerprint that `tools[]` was empty when the API call left the agent —
agent.json missing or stale, or the agent is on the pre-2.0 binary that
didn't read agent.json.

## Build (monorepo)

```bash
pnpm install --filter @openape/ape-agent...
pnpm --filter @openape/ape-agent build
node apps/openape-ape-agent/dist/bridge.mjs   # foreground
```
