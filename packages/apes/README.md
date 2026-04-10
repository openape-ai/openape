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

`ape-shell` is a drop-in shell that routes every command through a DDISA grant. It has two modes:

1. **One-shot mode** (`ape-shell -c "<command>"`) — the historical wrapper. Runs a single command through the grant flow and exits. Used by `$SHELL -c` patterns (e.g. `openclaw tui`, `xargs`, git hooks, sshd non-interactive sessions, etc.).
2. **Interactive mode** (`ape-shell` with no args, or as a login shell) — a full interactive REPL with a persistent bash backend. Every line the user types is routed through the grant flow **before** bash sees it, and executed in bash's persistent state (so `cd`, `export`, aliases, functions, pipes, TUI apps like `vim`/`less`/`top` all work natively).

### How the one-shot mode works

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

### How the interactive mode works

```
ape-shell
  ↓
┌─ PROMPT ─────────────────────────────────────────┐
│ apes$ <user types here>                          │
│   → multi-line detection via `bash -n` dry-parse │
│   → grant dispatch (adapter or ape-shell session)│
│   → on approval: write line to persistent bash   │
│   → stream output, detect prompt marker          │
└──────────────────────────────────────────────────┘
```

Every line is audited in `~/.config/apes/audit.jsonl` (session id, line, grant id, exit code).

### Setup for an AI agent session (one-shot mode)

```bash
# Point the agent's SHELL at ape-shell — each spawned command
# goes through the one-shot grant flow.
SHELL=$(which ape-shell) openclaw tui
```

The first command requests a session grant. After the human approves it (with `grant_type: timed, duration: 8h`), all subsequent commands reuse the same grant without interaction.

### Setup as a login shell (interactive mode)

```bash
# 1. Register ape-shell as a valid login shell (once per host)
echo "$(which ape-shell)" | sudo tee -a /etc/shells

# 2. Set it as the login shell for a user (e.g. openclaw)
sudo chsh -s "$(which ape-shell)" openclaw
```

After this:

- `ssh openclaw@host` — sshd starts ape-shell as an interactive REPL (sshd passes the login shell with a `-` prefix on argv[0], which ape-shell detects)
- `ssh openclaw@host "ls"` — sshd invokes `ape-shell -c "ls"`, which still flows through the **one-shot** path (no regression)
- `su - openclaw` — drops into the interactive REPL
- Terminal / console login — same as SSH interactive

### Example (one-shot)

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

### Example (interactive)

```bash
$ ape-shell
apes interactive shell
Ctrl-D to exit.

apes$ cd /tmp
# (grant approved, reused for free)

apes$ ls
# structured adapter grant for `ls` → approve → output

apes$ for i in 1 2 3; do
>   echo $i
> done
# single grant for the whole compound, bash runs it natively

apes$ vim notes.md
# grant approved → full TUI vim, raw-mode passthrough

apes$ ^D
Goodbye.
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
