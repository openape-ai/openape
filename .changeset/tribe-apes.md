---
'@openape/apes': minor
---

Tribe agent runtime + sync (M4-M6 of openape-tribe). New CLI subcommands:

- `apes agents sync` — pulls task list from `tribe.openape.ai`, reconciles `~/Library/LaunchAgents/openape.tribe.<agent>.<task>.plist`, caches task specs to `~/.openape/agent/tasks/`
- `apes agents run <task_id>` — launchd-invoked one-shot: loads cached spec, runs the LiteLLM tool-call loop, posts a run record to tribe
- `apes agents serve --rpc` — long-running stdio RPC server (replaces `pi --mode rpc` for chat-bridge in M8); line-delimited JSON in/out, conversation memory keyed by `session_id`

Built-in tools shipped: `time.now`, `http.get/post`, `file.read/write` (jailed to $HOME), `tasks.list/create` (via @openape/ape-tasks), `mail.list/search` (via o365-cli).

`apes agents spawn` integration:
- Installs `~/Library/LaunchAgents/openape.tribe.sync.<agent>.plist` (every 5min, RunAtLoad fires immediately) so the agent registers at tribe within seconds of spawn
- Drops `@mariozechner/pi-coding-agent` from the bun-install step (chat-bridge spawns `apes agents serve --rpc` directly in M8)
- Drops the pi-extension write at `~/.pi/agent/extensions/litellm.ts`
- Bridge env file relocates from `~/.pi/agent/.env` to `~/Library/Application Support/openape/bridge/.env`
- Spawn output now prints `🔗 Tribe: https://tribe.openape.ai/agents/<name>`

Override the tribe endpoint via `OPENAPE_TRIBE_URL` env var (default `https://tribe.openape.ai`).
