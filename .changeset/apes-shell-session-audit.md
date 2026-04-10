---
'@openape/apes': minor
---

feat(apes): audit logging for interactive shell sessions (M5 of ape-shell interactive mode)

Every interactive `ape-shell` session is now recorded in `~/.config/apes/audit.jsonl` with the following event types:

- `shell-session-start` — session id (16 random hex chars), host, requester email
- `shell-session-line` — per line: seq number, literal line, grant id, grant mode (adapter/session), status (executing/denied)
- `shell-session-line-done` — per completed line: seq number, exit code
- `shell-session-end` — duration, total line count

Denied lines are logged too, which gives you an auditable record of every attempted command in a session — whether it was executed or rejected by the grant flow.
