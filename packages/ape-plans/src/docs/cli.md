# ape-plans CLI reference

```
ape-plans <command> [args] [flags]
```

## Commands

| Group      | Command                              | Purpose                                   |
|------------|--------------------------------------|-------------------------------------------|
| Auth       | `login [email]`                      | Paste-based login via browser.            |
| Auth       | `logout`                             | Forget the token for current endpoint.    |
| Auth       | `whoami`                             | Show current identity.                    |
| Teams      | `teams`                              | List teams you belong to.                 |
| Teams      | `teams show <id>`                    | Show team detail with members + plans.    |
| Teams      | `teams new <name>`                   | Create a team; caller becomes owner.      |
| Teams      | `teams invite <team-id>`             | Generate a shareable invite URL.          |
| Teams      | `teams invites <team-id>`            | List active invites.                      |
| Teams      | `teams revoke-invite <invite-id>`    | Revoke an invite.                         |
| Invites    | `accept <url-or-token>`              | Accept an invite URL or token.            |
| Plans      | `list`                               | List plans across teams.                  |
| Plans      | `show <id>`                          | Print plan body (or JSON with --json).    |
| Plans      | `new --team <id> --title "..."`      | Create a plan.                            |
| Plans      | `edit <id>`                          | Edit body (opens $EDITOR).                |
| Plans      | `status <id> <status>`               | Change status.                            |
| Plans      | `rm <id>`                            | Soft-delete a plan.                       |
| Docs       | `docs [topic]`                       | Print documentation for agents.           |

## Global flags

- `--json` — structured JSON output (parseable by agents).
- `--quiet` — suppress progress messages (errors still to stderr).
- `--endpoint <url>` — override the plans endpoint.

## Environment variables

- `APE_PLANS_ENDPOINT` — default endpoint if `--endpoint` is not given.
- `EDITOR` / `VISUAL` — preferred editor for `plans new`/`edit`.

## Config location

`~/.openape/auth-plans.json` (chmod 600). Contains per-endpoint tokens. Remove it
to fully reset.
