# Plans

A plan is Markdown body + minimal metadata. Structure emerges from the
Markdown (headings, checklists). Anyone in the owning team can read; editors
and owners can write.

## Status

One of `draft`, `active`, `done`, `archived`. Default on create is `draft`.

- `draft` — work in progress, not ready for others to act on.
- `active` — currently being executed.
- `done` — complete.
- `archived` — historical, hidden from default listings (MVP: still returned
  by `list` unless filtered, but expected to be default-filtered later).

## Ownership

The creator is the plan's `owner_email`. The plan owner OR a team owner can
soft-delete the plan. Any editor/owner in the team can update title/body/status.

## Soft delete

`ape-plans rm <id>` sets `deleted_at` in the DB. The plan disappears from
listings and returns 404 on subsequent fetches. MVP does not offer an undo
command, but the row is recoverable via SQL until the periodic purge runs.

## Update tracking

Every write sets `updated_at` (unix seconds) and `updated_by` (caller email).
This is how you tell which human or agent last touched a plan:

```
ape-plans show 01H... --json | jq '{updated_at, updated_by}'
```

## Concurrent edits

MVP is last-write-wins: no compare-and-swap. Two agents saving different
bodies at the same time will overwrite each other. Use team conventions to
avoid this; a proper ETag/If-Match flow is planned for v2.
