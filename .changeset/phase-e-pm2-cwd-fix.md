---
'@openape/nest': patch
'@openape/apes': patch
---

Fix Phase E pm2-supervisor: three issues that conspired to make `pm2 startOrReload` silently fail when invoked from the Nest:

1. **`bash -c '<inline cmd>'` arg-quoting** — escapes-helper passes the command-array to bash as separate argv; `bash -c` then treats only the first item as the script body and the rest as `$0`/`$1`/... so redirects + sub-args got dropped silently. Switched to a per-agent `start.sh` wrapper script (mode 755) committed at spawn time.

2. **`process.cwd()` EACCES** — the Nest's cwd is `/var/openape/nest` (mode 750, _openape_nest only). After escapes setuid to the agent uid, Node's startup `uv_cwd()` failed with EACCES because the agent can't read the inherited cwd. Set `cwd: '/tmp'` on the supervisor's spawn so the new uid lands in a world-readable dir.

3. **pm2's exit code is non-zero in some success paths** — `pm2 startOrReload` exits with warnings/errors even when the operation succeeded. Added a `pm2 jlist` probe after start: if the expected app is `online`, log success regardless of the cli's exit code; otherwise log "NOT online" with a pointer to the per-agent pm2 log.

Plus: log dir `/var/log/openape/` needs mode 1777 so per-agent pm2 instances (different uids) can each append their own log file there. The `apes nest install` flow could create this idempotently in a follow-up; for now operators run `mkdir -p /var/log/openape && chmod 1777 /var/log/openape` once after upgrading.
