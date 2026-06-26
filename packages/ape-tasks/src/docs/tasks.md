# Tasks

A task is a short title plus minimal metadata. A list ("team") holds many
tasks; anyone in the team can read, editors and owners can write.

## Shape

```
{
  id:              "01HXX…",        // ULID
  team_id:         "01HYY…",
  title:           "Call the dentist",
  notes:           "",               // optional free text / Markdown
  status:          "open",           // open | doing | done | archived
  priority:        null,             // low | med | high | null
  due_at:          null,             // unix seconds, null = no due date
  assignee_email:  null,
  lane_id:         null,             // board lane id, null = first lane of its status bucket
  sort_order:      7,                // position in list, ascending
  owner_email:     "you@example.com",
  created_at:      1730000000,
  updated_at:      1730000000,
  updated_by:      "you@example.com",
  completed_at:    null              // set when status becomes 'done'
}
```

All timestamps are unix seconds.

## Status

- `open` — not started, actionable.
- `doing` — in progress (used for multi-step tasks or when you want to signal
  "I've picked this up" to collaborators).
- `done` — complete. Sets `completed_at`.
- `archived` — hidden from default listings. Recoverable.

Change via `ape-tasks status <id> <new>` or the shortcuts
`ape-tasks done <id>` and `ape-tasks reopen <id>`.

## Lanes

A team's board has configurable lanes (Trello-light columns) — e.g.
`Backlog → Ready → Doing → Review → Done`. Each lane maps to one status bucket
(`open`, `doing`, `done`), so lanes refine `status` rather than replace it.
Moving a task to a lane sets its status to that lane's bucket; `done` /
`reopen` / `status` move the task to the matching lane. A team with no lanes
configured shows three defaults (Open / Doing / Done); owners edit lanes in the
webapp.

- `ape-tasks lanes --team <id> [--json]` — list a team's lanes.
- `ape-tasks new --lane <id|name>` — create a task in a lane.
- `ape-tasks edit <id> --lane <id|name>` — move a task to a lane.
- `ape-tasks list --lane <id|name>` — filter a list to one lane.

`--lane` accepts a lane id or its name (case-insensitive). Combine
`--lane` with `--assignee` to get the actionable subset for one worker.

## Priority

`low`, `med`, or `high`. Optional — most tasks don't need one. Clear with
`--priority none`.

## Due dates

`--due` accepts ISO 8601 (`2026-05-01T09:00`, `2026-05-01`) or shorthand
relative to now: `+30m`, `+2h`, `+1d`, `+2w`. Clear with `--due none`.

## Assignee

`--assignee <email>` pins a task to a team member. The server does **not**
check membership — it stores whatever email you pass. Clear with
`--assignee none`.

## Ordering

`sort_order` is ascending integer. New tasks append to the end
(`max(sort_order) + 1`). Drag-reordering in the webapp writes this field;
the CLI currently has no reorder command.

## Ownership

The creator is the task's `owner_email`. Any editor/owner in the team can
update any field. Viewers are read-only (not enforced on every write
endpoint yet — MVP trust model).

## Soft delete

`ape-tasks rm <id>` sets `deleted_at`. Rows disappear from listings and
return 404. Recoverable via SQL until the periodic purge runs.

## Update tracking

Every write sets `updated_at` and `updated_by`. To see who last touched a
task:

```
ape-tasks show 01HXX... --json | jq '{updated_at, updated_by}'
```

## Concurrent edits

MVP is last-write-wins (no ETag / If-Match). Two agents PATCH-ing the same
task at the same time will overwrite each other. Use team conventions for
now — an optimistic-concurrency flow is planned.
