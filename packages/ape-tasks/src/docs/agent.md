# ape-tasks for agents

This CLI is the primary interface for AI agents working with tasks.openape.ai.
Humans can use the webapp; agents use these commands to read, create, update,
and share tasks across devices and conversations.

## First-time setup

```
npm i -g @openape/ape-tasks
ape-tasks login patrick@example.com
```

`ape-tasks login` prints a URL to open in a browser. The user signs in via
DDISA at their identity provider, clicks "Generate CLI token" on the tasks
page, copies the token, and pastes it into the CLI. The token is stored at
`~/.openape/auth-tasks.json` (chmod 600) and is valid for 30 days.

## Discover lists and tasks

```
ape-tasks whoami --json
# {"email":"patrick@example.com","act":"human","endpoint":"https://tasks.openape.ai"}

ape-tasks teams --json
# [{"id":"01H...","name":"Delta Mind","role":"owner","member_count":3,"open_task_count":4,"total_task_count":12,...}]

ape-tasks list --json
# [{"id":"01H...","team_id":"01H...","title":"Migrate auth","status":"open","priority":"high",...}]

ape-tasks list --team 01H... --status open,doing --json
```

## Read a task

Default output is a human-readable summary. Use `--json` for the full object.

```
ape-tasks show 01H...
ape-tasks show 01H... --json | jq .status
```

## Create tasks

```
# Minimum: title + list. Team can be omitted once `teams use <id>` is set.
ape-tasks new --team 01H... --title "Migrate auth"

# With fields:
ape-tasks new --team 01H... --title "Ship PR" \
  --priority high --due +2d --assignee someone@example.com \
  --notes "Focus: auth refactor, revert if Sentry spikes."

# Inline notes via heredoc — no tempfile needed:
ape-tasks new --team 01H... --title "Release notes" --notes-from-stdin <<'EOF'
- bump version
- changelog entry
- announce in #releases
EOF

# Set an active list once, then omit --team:
ape-tasks teams use 01H...
ape-tasks new --title "No --team needed"

# Get just the id for scripting:
ID=$(ape-tasks new --title "Bot check" --id-only)
```

## Update tasks

```
# Patch any field. Others untouched.
ape-tasks edit 01H... --title "Call the dentist 3pm"
ape-tasks edit 01H... --priority high --due +1d
ape-tasks edit 01H... --assignee none           # clear assignee
ape-tasks edit 01H... --due none                # clear due
ape-tasks edit 01H... --notes-from-file updates.md

# Status shortcuts
ape-tasks status 01H... doing
ape-tasks done 01H...
ape-tasks reopen 01H...

# Soft delete
ape-tasks rm 01H...
```

## Board lanes

A team's board has configurable lanes (columns) — e.g. `Backlog → Ready →
Doing → Review → Done`. Each lane maps to one status bucket (`open`, `doing`,
or `done`), so lanes are a finer view on top of `status`: moving a task to a
lane also sets its status to that lane's bucket. A team with no lanes
configured shows three defaults (Open / Doing / Done). Owners edit lanes in the
webapp.

```
# See a team's lanes
ape-tasks lanes --team 01H... --json
# [{"id":"01H...","name":"Ready","status":"open"}, ...]

# Place a new task directly in a lane (status follows the lane's bucket)
ape-tasks new --team 01H... --title "Wire up X" --lane Ready

# Move a task between lanes (id or name, case-insensitive)
ape-tasks edit 01H... --lane Review        # → status becomes doing
ape-tasks done 01H...                        # → moves to the Done lane

# Filter a list to one lane (id or name)
ape-tasks list --team 01H... --lane Ready --json
```

`done` / `reopen` keep working unchanged — they set status and move the task to
the matching lane. `--lane` accepts a lane id or its name.

### Driving an automated loop off a lane

The clean "what should I work on now" gate is **one lane + one assignee**:

```
ape-tasks list --team 01H... --lane Ready --assignee bot@example.com --json
```

Move a task to a "Doing"-bucket lane to mark it in progress, and to a later
lane (or back) to hand it on. The `--json` shape carries `lane_id`; resolve
names↔ids once via `ape-tasks lanes --json`.

## Invite other agents or humans

```
ape-tasks teams invite 01H... --max-uses 1 --expires-in 24h --note "agent onboarding"
# → https://tasks.openape.ai/invite?t=eyJhbGc...

ape-tasks accept https://tasks.openape.ai/invite?t=eyJhbGc...
```

One agent generates an invite URL, passes it to the other (message, file,
stdin), the other runs `ape-tasks accept <url>`. Both are then members of
the same team and see each other's tasks.

## Task object schema

```json
{
  "id":              "01HXX...",
  "team_id":         "01HXX...",
  "title":           "Migrate auth",
  "notes":           "...optional plain or Markdown...",
  "status":          "open" | "doing" | "done" | "archived",
  "priority":        null | "low" | "med" | "high",
  "due_at":          null,
  "assignee_email":  null,
  "lane_id":         null,
  "sort_order":      7,
  "owner_email":     "creator@example.com",
  "created_at":      1735689600,
  "updated_at":      1735689600,
  "updated_by":      "last-editor@example.com",
  "completed_at":    null
}
```

All timestamps are unix seconds.

## Error codes

| HTTP | Meaning |
|------|---------|
| 400  | Bad input (missing field, invalid status/priority, unparseable --due). Read `.title` in the JSON response. |
| 401  | Not logged in. Run `ape-tasks login <email>`. |
| 403  | Not a team member, or role insufficient (viewers cannot edit/create). |
| 404  | Team or task not found, or soft-deleted. |
| 410  | Invite gone (expired, revoked, or out of uses). |
| 500+ | Server error. Retry later; include `endpoint` in bug reports. |

Error bodies follow RFC 7807-ish shape: `{ "title": "<human message>" }`.
The CLI echoes `title` to stderr and exits non-zero.

## Scripting tips

- `--json` is stable. Shape changes are major-version.
- `--quiet` silences progress, errors still go to stderr.
- Exit code 0 = success, non-zero = error.
- All timestamps are unix seconds (not milliseconds).
- ULIDs are sortable. `ape-tasks list --json | jq 'sort_by(.sort_order)'`
  works, although the API already sorts by `sort_order`.
- `--endpoint <url>` overrides the endpoint (tests, dev server). Default:
  `https://tasks.openape.ai` or `APE_TASKS_ENDPOINT`.
- `--due` accepts ISO 8601 or shorthand `+30m`, `+2h`, `+1d`, `+2w`. Use
  `none` or empty string to clear.
- `--priority low|med|high` or `none` to clear.
- `--assignee email` or `none` to clear.
