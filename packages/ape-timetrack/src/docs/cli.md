# ape-timetrack CLI reference

Login once per device: `apes login <email>` (shared across all OpenApe CLIs).

## Commands

```
ape-timetrack whoami [--json]
ape-timetrack open [--print-only]

ape-timetrack companies [--json]                 # list visible companies
ape-timetrack companies new --name "..."         # create (you = owner)
ape-timetrack companies use <id>                 # set default company
ape-timetrack companies invite <id> --role owner|manager|member

ape-timetrack projects [--company <id>] [--json] # list visible projects
ape-timetrack projects new --name "..." [--company <id>] [--description "..."]
ape-timetrack projects use <id>                  # set default project
ape-timetrack projects invite <id> --role manager|member

ape-timetrack members [--company <id>] [--project <id>] [--json]
ape-timetrack accept <invite-url-or-token> [--json]

ape-timetrack log --project <id> --duration 1h30m [--type code] \
  [--from 14:00 --to 14:45] [--date YYYY-MM-DD] [--no-billable] [--break] --desc "..."
  # --break logs a pause (never billable; reports tally it separately)
ape-timetrack me [--month YYYY-MM] [--json]   # your own hours across all projects + overlap warnings
ape-timetrack list [--company <id>] [--project <id>] [--from <d>] [--to <d>] [--mine] [--json]
ape-timetrack edit <entry-id> [--duration|--desc|--type|--billable|--date ...]
ape-timetrack rm <entry-id>

ape-timetrack report [--company <id>] [--project <id>] [--from <d>] [--to <d>] \
  [--by project|type|user|day] [--json]

ape-timetrack docs [agent|cli|errors]
```

Common flags: `--json` (machine output to stdout), `--endpoint <url>`
(override; default `https://timetrack.openape.ai`, env
`APE_TIMETRACK_ENDPOINT`).

Defaults: `companies use` / `projects use` store a default so you can omit
`--company` / `--project`. Local state: `~/.openape/auth-timetrack.json`.

## Roles & visibility

Company roles: owner (full), manager (read-only company-wide reporting),
member (access only via project roles). Project roles: manager (all entries
in the project), member (own entries only). Rights = max of company + project
role. Author always sees/edits their own entries. Edit/delete: author,
project manager, or company owner.
