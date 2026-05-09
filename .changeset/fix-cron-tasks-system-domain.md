---
'@openape/apes': patch
---

Fix cron tasks never firing on hidden service-account agents. Tasks plists were going to `~/Library/LaunchAgents/` and `launchctl bootstrap gui/<uid>` — same dead-end as the troop sync plist had before #338. Move task plists to `/Library/LaunchDaemons/` with `UserName=<agent>`, bootstrap into `system` domain. Sync daemon now runs as ROOT (so it can write into `/Library/LaunchDaemons/` and bootstrap system-domain jobs); chowns its writes in the agent's `$HOME` back to the agent uid via stat(`$HOME`).
