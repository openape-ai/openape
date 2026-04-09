# @openape/apes

The unified OpenApe CLI for interacting with a DDISA Identity Provider — handles authentication, grants, delegations, adapter-based command authorization, and MCP server integration.

Ships three binaries:
- **`apes`** — main CLI (login, grants, run, admin, etc.)
- **`ape-shell`** — grant-secured shell wrapper (drop-in replacement for `bash -c`)
- MCP server mode via `apes mcp`

## Installation

```bash
pnpm add -g @openape/apes
# or: npm install -g @openape/apes
```

After installation you have `apes` and `ape-shell` in your PATH.

## Quick Start

```bash
# 1. Login to an IdP (opens browser for PKCE flow)
apes login --idp https://id.example.com

# 2. Check who you are
apes whoami

# 3. Request a grant and run a command
apes run -- git status
# → creates a grant, waits for approval, executes

# 4. List your grants
apes grants list
```

## ape-shell: Grant-Secured Shell Wrapper

`ape-shell` is a drop-in shell replacement that routes every command through a DDISA grant. Useful for sandboxing AI coding agents (OpenClaw, Claude Code, etc.) so they can only execute pre-approved commands.

### How it works

```
$SHELL -c "git status"
  ↓
ape-shell -c "git status"
  ↓
apes run --shell -- bash -c "git status"
  ↓
1. Find existing ape-shell session grant (timed/always)
2. Grant found → execute immediately
3. No grant → request + wait for human approval → execute
```

### Setup for an AI agent session

```bash
# Point the agent's SHELL at ape-shell
SHELL=$(which ape-shell) openclaw
```

The first command requests a session grant. After the human approves it (with `grant_type: timed, duration: 8h`), all subsequent commands reuse the same grant without interaction.

### Example

```bash
$ apes login
$ ape-shell -c "git status"
ℹ Requesting ape-shell session grant on my-host
ℹ Grant requested: grant_abc123
ℹ Waiting for approval...
# Human approves in browser → command executes
On branch main

$ ape-shell -c "git log --oneline -5"
# Grant is reused automatically — no approval prompt
abc123 Latest commit
def456 Previous commit
...
```

## Commands

### Authentication

| Command | Description |
|---|---|
| `apes login` | PKCE browser login or ed25519 key-based agent login |
| `apes logout` | Clear stored auth |
| `apes whoami` | Show current identity |
| `apes enroll` | Enroll an agent at the IdP |
| `apes register-user` | Register a new human user |

### Grants

| Command | Description |
|---|---|
| `apes grants list` | List all grants |
| `apes grants inbox` | Show pending approval requests |
| `apes grants request` | Request a new grant |
| `apes grants approve <id>` | Approve a grant |
| `apes grants deny <id>` | Deny a grant |
| `apes grants revoke <id>` | Revoke an active grant |
| `apes grants token <id>` | Get the JWT for an approved grant |
| `apes grants delegate` | Create a delegation grant |

### Execution

| Command | Description |
|---|---|
| `apes run -- <cmd>` | Run a command via a shapes adapter grant |
| `apes run --shell -- bash -c <cmd>` | Shell mode (used by `ape-shell`) |
| `apes run --as root -- <cmd>` | Elevate via `escapes` (separate binary) |
| `apes explain -- <cmd>` | Explain what grant a command would need |

### Configuration

Auth and config are stored in `~/.config/apes/`:
- `auth.json` — access token, email, IdP URL
- `config.toml` — defaults (idp, agent key path, etc.)

```bash
apes config get defaults.idp
apes config set defaults.idp https://id.example.com
```

## MCP Server

```bash
apes mcp --transport stdio
# or
apes mcp --transport sse --port 3001
```

Exposes all grant operations as MCP tools so AI agents (Claude Desktop, Cursor, etc.) can request and use grants directly.

## See Also

- [DDISA Protocol](https://github.com/openape-ai/protocol) — the underlying identity and authorization protocol
- [OpenApe Docs](https://docs.openape.at) — full platform documentation
- [`escapes`](https://github.com/openape-ai/escapes) — Rust binary for privilege escalation (`apes run --as root`)

## License

MIT © Patrick Hofmann — [Delta Mind GmbH](https://delta-mind.at)
