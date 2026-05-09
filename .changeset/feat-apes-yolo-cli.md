---
'@openape/apes': minor
---

New top-level `apes yolo` command for managing YOLO-policies on DDISA agents you own:
- `apes yolo set <email> --mode allow-list --allow "apes agents spawn *,..."` — write/update policy
- `apes yolo show <email>` — read current policy (--json for scripts)
- `apes yolo clear <email>` — remove policy (subsequent grants need human approval)

`apes nest authorize` is now a thin wrapper that shells out to `apes yolo set` instead of doing raw `fetch` calls. Same end-state for the user; YOLO-management is now reusable for non-nest agents too.

Plus: `apes nest install` now adds `--wait` to the daemon's spawn invocation so the YOLO-auto-approved grant actually executes (without `--wait`, apes run exits 75 EX_TEMPFAIL the moment the grant is created, even when YOLO approves milliseconds later).
