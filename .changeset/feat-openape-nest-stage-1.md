---
'@openape/apes': minor
'@openape/nest': minor
---

**Stage 1 of the Nest control-plane** (per [plan 01KR5TXQXWDC1YDESJJYTPFFMK](https://plans.openape.ai/plans/01KR5TXQXWDC1YDESJJYTPFFMK)). The Nest is a local daemon that hosts agents on a single computer — once installed, `apes agents spawn` becomes fast (no per-spawn DDISA approvals required after the one-time always-grant) and per-agent launchd plists get replaced by a single supervised process tree.

**New package** `@openape/nest`: HTTP daemon on `127.0.0.1:9091` with `/agents` (POST/DELETE/GET) and `/status` endpoints; persistent registry at `~/.openape/nest/agents.json`; supervisor for chat-bridge children with bounded backoff restart.

**New `@openape/apes` verbs**:
- `apes nest install` — writes `~/Library/LaunchAgents/ai.openape.nest.plist`, bootstraps it, prints next-step instructions for the always-grant
- `apes nest status` — talks to the daemon, lists supervised processes
- `apes nest uninstall` — bootouts + removes the plist (registry preserved)

Stage 1 MVP runs the nest as the human user (eventual migration to a dedicated `_openape_nest` service-account is Stage 1.5). Migration of existing agents from per-agent launchd plists into supervisor-managed children comes in a follow-up PR.
