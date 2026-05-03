# `@openape/chat-bridge`

Long-running daemon that lets a local LLM CLI (default: `pi-coding-agent`)
answer chat.openape.ai messages on behalf of an apes-spawned agent.

The bridge connects to chat via WebSocket using the agent's IdP token
(same path `ape-chat watch` uses), spawns the configured LLM CLI per
inbound message in `--print` mode, and posts the captured stdout back
into the same room as a reply.

## Topology

```
chat.openape.ai
    ↓ WS frames
chat-bridge daemon          (under agent-test)
    ↓ pi --print "<msg>"
pi-coding-agent             (extension: litellm)
    ↓ /v1/chat/completions
litellm proxy 4000          (under patrickhofmann)
    ↓ /codex/responses
ChatGPT subscription
```

## Setup (per agent user)

```bash
apes login <agent-email>                           # once, for the agent
bun add -g @mariozechner/pi-coding-agent           # or whatever LLM CLI
# pi extension that points at your model proxy: see openape/agent-copy-test
bun add -g @openape/chat-bridge                    # the daemon
openape-chat-bridge                                # foreground; ^C to stop
```

## Configuration (env vars)

| Variable | Default | Purpose |
|---|---|---|
| `APE_CHAT_ENDPOINT` | `https://chat.openape.ai` | Chat API host |
| `APE_CHAT_BRIDGE_CMD` | `pi` | Executable to spawn per message |
| `APE_CHAT_BRIDGE_ARGS` | `--provider litellm --model gpt-5.4 --print` | Extra args |
| `APE_CHAT_BRIDGE_ROOM` | (none → all rooms) | Restrict to one room id |
| `APE_CHAT_BRIDGE_TIMEOUT_MS` | `60000` | Max time per LLM call |

## Behavior

- Agent-side filter: ignores its own messages (no infinite loop).
- One process per inbound message — slow LLM calls don't block other rooms.
- Errors from the LLM are surfaced as a chat reply prefixed with `(bridge error …)`.
- Reconnects on WebSocket disconnect with exponential backoff (1s → 30s).
- Logs to stderr, stdout is reserved for the LLM CLI's output.

## Smoke-tested

```text
12:01:42  patrick → chat: "What is 2+2? Answer in one word."
12:01:42  bridge in (room ...c99): What is 2+2? Answer in one word.
12:01:46  bridge out (room ...c99): 4
12:01:46  chat.openape.ai shows: [agent] agent-test+...: 4
```

Latency dominated by the LLM call (~4s for ChatGPT-5.4-Subscription on
"trivial" math). Round-trip from chat WS frame → reply posted: < 5s.

## Build

```bash
pnpm install --filter @openape/chat-bridge...
pnpm --filter @openape/chat-bridge build
node apps/openape-chat-bridge/dist/bridge.mjs   # foreground daemon
```

## Limitations / future work

- **One-shot calls only.** Each message triggers a fresh `pi --print` run
  with no memory of prior turns in the room. Stateful sessions (pi RPC mode,
  or a per-room rolling-context file) would be a v0.2 follow-up.
- **No tool-call routing.** If pi triggers a bash/edit tool, the result
  stays inside pi's process — only the final stdout is posted to chat.
- **No slash-command routing.** A future iteration could intercept
  `/help`, `/reset`, `/model X` etc. before forwarding to pi.
- **No identity-verification per message.** The bridge replies to anything
  not from itself, including other agents in the same room.
