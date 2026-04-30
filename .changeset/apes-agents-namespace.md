---
"@openape/apes": minor
---

apes: new `apes agents` namespace for managing owned agents end-to-end (`register`, `spawn`, `list`, `destroy`)

Adds a four-command surface so spawning + tearing down ephemeral agents is no longer a hand-assembly job:

- `apes agents register --name <n> --public-key '<line>'` — parent-authenticated `POST /api/enroll`. Returns the assigned agent email so a remote agent can `apes login` from its own machine using the matching private key. No keypair generation, no token issuance.
- `apes agents spawn <n>` (macOS only) — provisions a local agent in one shot: generates an ed25519 keypair, registers it at the IdP, issues an agent access token, then runs a bash setup script under `apes run --as root` that creates a hidden macOS service user, places `~/.ssh/id_ed25519`, writes `~/.config/apes/auth.json`, sets `ape-shell` as login shell, and (unless `--no-claude-hook`) drops a Claude Code PreToolUse hook that rewrites every Bash tool call to `ape-shell -c '<cmd>'`. One DDISA approval per spawn, no `sudo` involved.
- `apes agents list [--json] [--include-inactive]` — `GET /api/my-agents` with local `/Users` cross-reference so orphaned IdP agents (no OS user) show as `OS-USER ✗`.
- `apes agents destroy <n> [--force] [--soft] [--keep-os-user]` — idempotent teardown. Hard-delete by default; `--soft` flips `isActive=false` instead; `--keep-os-user` skips the privileged escapes call so CI loops without an approver still work.

End-to-end use:

```bash
apes login patrick@hofmann.eco
apes agents spawn agent-a
apes run --as agent-a -- claude --session-name agent-a --dangerously-skip-permissions
apes agents destroy agent-a --force
```

Pre-flight (one-time per host): `ape-shell` must be in `/etc/shells`, `escapes` must be on PATH, and the parent must have an `as=root` authorization in their DDISA chain for spawn/destroy.
