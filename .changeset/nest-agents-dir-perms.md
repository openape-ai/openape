---
"@openape/nest": patch
---

`/var/openape/agents/` (where the pm2-supervisor writes per-agent
ecosystem.config.js + start.sh) now gets created with mode 2775
(`drwxrwsr-x` — group-write + setgid) instead of 755. Without this,
the nest daemon (running as the human user) couldn't mkdir/write
under the dir because root had created it with stricter perms on
an earlier install — pm2-supervisor logged `EACCES: permission
denied` on every reconcile and bridges never started for agents
spawned via the troop UI.

Two-tier fix:
- `migrate-to-service-user.sh` pre-creates `/var/openape/agents/`
  with the right perms (root-only operation, runs at install/upgrade).
- `pm2-supervisor.ts` re-asserts the setgid bit on every reconcile
  via an explicit chmod after the mkdir, since mkdir's mode is
  masked by the process umask and setgid usually doesn't survive.
  Repair fails silently if the daemon isn't group-owner — operators
  on legacy installs re-run `migrate-to-service-user.sh`.
