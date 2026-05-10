---
'@openape/nest': minor
'@openape/apes': minor
---

Phase E of the architecture simplification (#sim-arch): bridge processes are now supervised by a **per-agent** pm2-god daemon running as the agent's own macOS uid.

**Process tree per agent**:

```
launchd → nest (uid 481 _openape_nest)
            └── shell-outs: `apes run --as agentx -- pm2 startOrReload <ecosystem>`
                  └── escapes (root, setuid switch)
                        └── pm2-god (uid agentx)  ← persistent across Nest restarts
                              └── openape-chat-bridge (uid agentx)  ← direct pm2 child
```

**What you get**:
- `pm2 list` / `pm2 logs` / `pm2 monit` work natively per agent (`su -m agentx -c 'pm2 list'`)
- Per-agent `~/.pm2/logs/<bridge>-out-N.log` with built-in rotation
- Each agent's pm2-daemon is its own crash domain
- Bridge process is a direct child of pm2 (not a grandchild via apes-run)
- pm2 inherits the agent's uid — no privilege expansion (the Nest stays as `_openape_nest`)

**Per-agent ecosystem file**: written to `/var/openape/nest/agents/<name>/ecosystem.config.js`. Operators can hand-edit + reload via `apes run --as <agent> -- pm2 reload openape-bridge-<agent>`.

**YOLO defaults extended** to cover `pm2 startOrReload *`, `pm2 delete openape-bridge-*`, `pm2 jlist` — re-run `apes nest authorize` after upgrading.

**Operator setup** (one-time): pm2 must be on the host PATH for every agent. `npm i -g pm2` once on the host (the agents inherit `/opt/homebrew/bin/` via the host-PATH-capture from PR #376).
