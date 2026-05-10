---
'@openape/nest': patch
---

Fix Phase E pm2-supervisor: ecosystem.config.js files move from `/var/openape/nest/agents/` (mode 750, _openape_nest-only) to `/var/openape/agents/` (mode 755, world-traversable). Per-agent pm2 daemons run as the agent uid and need to read their own config file; the Nest's private state stays where it was.
