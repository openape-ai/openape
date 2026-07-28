# ape-tasks CLI reference

```
ape-tasks <command> [args] [flags]
```

## Commands

| Group  | Command                              | Purpose                                          |
|--------|--------------------------------------|--------------------------------------------------|
| Auth   | `login [email]`                      | Paste-based login via browser.                   |
| Auth   | `logout`                             | Forget the token for current endpoint.           |
| Auth   | `whoami`                             | Show current identity.                           |
| Teams  | `teams`                              | List lists (teams) you belong to.                |
| Teams  | `teams show <id>`                    | Show list detail with members + task counts.     |
| Teams  | `teams new <name>`                   | Create a list; caller becomes owner.             |
| Teams  | `teams use <id>`                     | Set active list (future commands omit `--team`). |
| Teams  | `teams update <id> …`                | Rename or edit description.                      |
| Teams  | `teams archive \| unarchive <id>`    | Hide from default listings.                      |
| Teams  | `teams rm <id> [--force]`            | Delete a list.                                   |
| Teams  | `teams invite <team-id>`             | Generate a shareable invite URL.                 |
| Teams  | `teams invites <team-id>`            | List active invites.                             |
| Teams  | `teams revoke-invite <invite-id>`    | Revoke an invite.                                |
| Invite | `accept <url-or-token>`              | Accept an invite URL or token.                   |
| Tasks  | `list [--team] [--status] [--lane] [--assignee]` | List tasks (default statuses: open,doing). |
| Tasks  | `lanes [--team]`                     | List a team's board lanes (id, name, status).    |
| Tasks  | `show <id>`                          | Print task summary (or JSON with --json).        |
| Tasks  | `new --title "..."`                  | Create a task. See "Task fields" below.          |
| Tasks  | `edit <id> …`                        | Patch any field; use `none` to clear optional.   |
| Tasks  | `status <id> <status>`               | Change status (open/doing/done/archived).        |
| Tasks  | `done <id>`                          | Shorthand for `status <id> done`.                |
| Tasks  | `reopen <id>`                        | Shorthand for `status <id> open`.                |
| Tasks  | `rm <id>`                            | Soft-delete a task.                              |
| Tasks  | `open <id>`                          | Open the task's list in the web UI.              |
| Docs   | `docs [topic]`                       | Print embedded documentation.                    |

## Task fields (on `new` / `edit`)

- `--title "..."` — required on `new`, optional on `edit`. 1–200 chars.
- `--notes "..."` / `--notes-from-stdin` / `--notes-from-file <path>` — free
  text or Markdown. Mutually exclusive (file wins, then stdin, then inline).
- `--status open|doing|done|archived` — default `open` on `new`.
- `--priority low|med|high` — or `none` to clear (on `edit`).
- `--due <when>` — ISO 8601 (`2026-05-01T09:00`, `2026-05-01`) or shorthand
  (`+30m`, `+2h`, `+1d`, `+2w`). Use `none` to clear.
- `--assignee <email>` — or `none` to clear.
- `--lane <id|name>` — place (`new`) or move (`edit`) the task into a board
  lane. Sets status to the lane's bucket. Accepts a lane id or its name
  (case-insensitive). See `ape-tasks docs tasks` → Lanes.

## Global flags

- `--json` — structured JSON output (parseable by agents).
- `--quiet` — suppress progress messages (errors still to stderr).
- `--endpoint <url>` — override the tasks endpoint.
- `--id-only` (on create commands) — print only the new id.

## Environment variables

- `APE_TASKS_ENDPOINT` — default endpoint if `--endpoint` is not given.
- `EDITOR` / `VISUAL` — preferred editor (unused by current task commands;
  reserved for future `notes --edit` flow).

## Config location

`~/.openape/auth-tasks.json` (chmod 600). Per-endpoint tokens + the active
list ULID. Remove it to fully reset.
