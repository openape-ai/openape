# @openape/apes

The unified OpenApe CLI for interacting with a DDISA Identity Provider — handles authentication, grants, delegations, per-call command authorization at the IdP, and MCP server integration.

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

# 3. Run a command authorized by the IdP
apes run --wait -- git status
# → the IdP authorizes this exact call (or waits for your approval), then it runs

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
│   → grant dispatch (program or ape-shell session)│
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

A line that is exactly one program call is authorized per call at the IdP (see [How commands are authorized](#how-commands-are-authorized)); an `always` approval covers later identical calls. Every other line (pipes, expansions, builtins) requests an ape-shell session grant; after the human approves it (with `grant_type: timed, duration: 8h`), later such lines reuse it without interaction.

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
$ APE_WAIT=1 ape-shell -c "git status"
ℹ Grant requested: grant_abc123
ℹ Approve at: https://id.example.com/grant-approval?grant_id=grant_abc123
# Human approves in browser (as "always") → the IdP authorizes the call → it runs
On branch main

$ ape-shell -c "git status"
# Covered by the approved grant — no approval prompt
On branch main
```

### Example (interactive)

```bash
$ ape-shell
apes interactive shell
Ctrl-D to exit.

apes$ cd /tmp
# builtin → ape-shell session grant (approved once, reused)

apes$ ls -la
# one program call → authorized at the IdP for exactly this command → output

apes$ for i in 1 2 3; do
>   echo $i
> done
# not a single program call → ape-shell session grant, bash runs it natively

apes$ vim notes.md
# grant approved → full TUI vim, raw-mode passthrough

apes$ ^D
Goodbye.
```

## How commands are authorized

`apes run -- <program> <args…>`, `ape-shell` and the MCP tool `apes.run` send every
program call to the IdP: `POST {idp}/api/grants/authorize` with the program name
(basename of the executable found on `PATH`), the SHA-256 of that file and the
arguments exactly as they will run. apes never resolves commands with adapter files;
only the IdP knows the Shapes registry and decides:

- **approved** — an approved grant covers the call. The IdP answers with a short
  command token. apes checks its signature against the IdP's JWKS, the issuer, its
  own identity as subject, the target host, the argv hash of exactly this command and
  the hash of the file it is about to run, and only then runs that file with these
  arguments. A single-use grant is consumed (`POST /api/grants/{id}/consume`) before
  the command runs; identical calls reuse a reusable token until it expires.
- **pending** — the IdP created (or reuses) a request for your approval. Without
  `--wait` apes prints it and exits 75; with `--wait` (or `APE_WAIT=1`) it waits up
  to 5 minutes and asks again after approval. A wait that runs out never runs the
  command.
- **denied / revoked** — apes refuses.

A program without a registry shape is approved as its exact command. `--approval`
accepts `once` (default) or `always`.

The program name is a claim of the requester; the file that runs is bound by its
hash in the token and checked again right before it runs. A grant answers a
permission question, not a capability one: for gated agents, keep every
agent-writable directory off their `PATH` and never use one as a program location.

## Commands

### Authentication

| Command | Description |
|---|---|
| `apes login` | PKCE browser login or ed25519 key-based agent login |
| `apes logout` | Clear stored auth |
| `apes whoami` | Show current identity |
| `apes enroll` | Enroll an agent at the IdP (interactive, browser approval) |
| `apes register-user` | Register a new human user |

### Agents

| Command | Description |
|---|---|
| `apes agents register --name <n> --public-key <line>` | Register an agent at the IdP using a public key supplied by the agent. Returns the assigned email so the agent can `apes login` from its own machine. |
| `apes agents spawn <n>` | macOS-only. Provision a local agent end-to-end: macOS user, ed25519 keypair, IdP registration, agent token, ape-shell as login shell, Claude Code Bash hook. Privileged setup runs through `apes run --as root` (DDISA-approved). |
| `apes agents list [--json] [--include-inactive]` | List agents owned by the current user, with local OS-user cross-reference. |
| `apes agents destroy <n> [--force] [--soft] [--keep-os-user]` | Tear down an agent. Idempotent; safe for CI with `--force`. |

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
| `apes run -- <cmd>` | Run a program call authorized per call by the IdP |
| `apes run --shell -- bash -c <cmd>` | Shell mode (used by `ape-shell`) |
| `apes run --as root -- <cmd>` | Elevate via `escapes` (separate binary) |
| `apes explain -- <cmd>` | Preview how the IdP resolves a command (`POST /api/shapes/resolve`) |
| `apes adapter list\|info\|search` | Show the Shapes adapters known to the IdP (read-only) |

### Configuration

Auth and config are stored in `~/.config/apes/`:
- `auth.json` — access token, email, IdP URL
- `config.toml` — defaults (idp, agent key path, etc.)

```bash
apes config get defaults.idp
apes config set defaults.idp https://id.example.com
```

## Spawning ephemeral agents (macOS)

`apes agents spawn <name>` provisions a complete local agent in one shot:

```bash
apes login patrick@hofmann.eco
apes agents spawn agent-a
# → DDISA approval prompt for the as=root grant (one-time per spawn)
# → "Agent agent-a spawned. Run: apes run --as agent-a -- claude --session-name agent-a --dangerously-skip-permissions"

apes agents list
# NAME     EMAIL                                          ACTIVE  OS-USER  HOME
# agent-a  agent-a+patrick+hofmann_eco@id.openape.ai      ✓       ✓        /Users/agent-a

apes run --as agent-a -- claude --session-name agent-a --dangerously-skip-permissions
# Claude Code runs as agent-a; every Bash tool call is rewritten to
# `ape-shell -c <cmd>` by ~/.claude/hooks/bash-via-ape-shell.sh, so the
# agent cannot run a shell command without an apes grant.

apes agents destroy agent-a --force
# → DDISA approval for the as=root teardown grant; agent and OS user are gone
```

Pre-flight requirements (one-time):

```bash
echo "$(which ape-shell)" | sudo tee -a /etc/shells
# `escapes` (Rust setuid binary) installed on PATH for `apes run --as root`
```

For remote agents that run on another machine, register without provisioning:

```bash
# On the agent's machine:
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -N ""

# On your machine (logged in as the parent):
apes agents register --name agent-x --public-key "$(ssh agent-host cat ~/.ssh/id_ed25519.pub)" --json
# → {"email":"agent-x+patrick+hofmann_eco@id.openape.ai","name":"agent-x","owner":"patrick@hofmann.eco","approver":"patrick@hofmann.eco","idp":"https://id.openape.ai"}

# Tell the agent to log in:
# apes login --idp https://id.openape.ai --email agent-x+patrick+hofmann_eco@id.openape.ai --key ~/.ssh/id_ed25519
```

`destroy --keep-os-user --force` reverses just the IdP side without invoking
`apes run --as root`, so it's safe for CI loops where no DDISA approver is
available.

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
