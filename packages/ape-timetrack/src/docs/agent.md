# ape-timetrack — Agent Reference

Time tracking by **company → project** for `timetrack.openape.ai`. You (an
agent) can record time **on behalf of** a user. Entries you create are
tagged `act=agent` automatically (derived from the apes session token).

## Auth

The user runs `apes login <email>` once per device. Every `ape-timetrack`
call then authenticates via the shared apes session — no per-CLI login.
All commands accept `--json` for machine-readable stdout (human text goes to
stderr, so `... --json 2>/dev/null | jq .` is safe).

## Resolve names → IDs (do this first)

You generally get a company/project **name** from the user, but the API
needs **IDs**. Resolve them:

```
ape-timetrack companies --json            # [{id,name,role}]
ape-timetrack projects --company <CID> --json   # [{id,name,role}]
```

Pick the entry whose `name` matches (case-insensitive). If none exists and
the user is a company owner, create it:

```
ape-timetrack companies new --name "Delta Mind" --json     # -> {id}
ape-timetrack projects new --company <CID> --name "IURIO" --json
```

Set defaults so later calls are terse:

```
ape-timetrack companies use <CID>
ape-timetrack projects use <PID>
```

## Log time (the core action)

After finishing a block of work, log it:

```
ape-timetrack log --project <PID> --duration 1h30m \
  --type code --desc "QR-Login Fix" --json
```

- `--duration` accepts `45` (minutes) or `1h30m`. Alternatively pass
  `--from 14:00 --to 14:45` (with optional `--date YYYY-MM-DD`).
- `--type` in code|research|planning|review|admin|meeting (default code).
- `--billable` default true; pass `--no-billable` for non-billable time.
- `--break` logs a pause (forced non-billable; reported separately as break time).
- `--date YYYY-MM-DD` to backdate (default: today UTC).

You may only log on a project where the user is a project member/manager or
company owner. Company *managers* cannot log (read-only reporting role).

## Inspect & report

```
ape-timetrack list --project <PID> --json
ape-timetrack report --company <CID> --by project --json
ape-timetrack report --from 2026-05-01 --to 2026-05-31 --by day --json
```

`report` returns `{ total_minutes, billable_minutes, groups[] }` — only
entries you are allowed to see (RBAC enforced server-side).

## Typical agent flow

1. `ape-timetrack companies --json` → find/confirm company id
2. `ape-timetrack projects --company <CID> --json` → find project id
3. `ape-timetrack log --project <PID> --duration <m> --type <t> --desc "<what>" --json`
4. Optionally `ape-timetrack report --company <CID> --json` to confirm totals

This is independent of the local `claude-log` JSONL — that keeps running
separately; timetrack is the shared server-side record.
