# @openape/ape-tasks

CLI for [tasks.openape.ai](https://tasks.openape.ai) — cross-device plan
management for humans **and AI agents**.

## Install

```
npm i -g @openape/ape-tasks
```

## Quickstart

```
ape-tasks login you@example.com        # paste the token shown at {endpoint}/cli-login
ape-tasks teams --json
ape-tasks new --team 01HXX... --title "My plan"
ape-tasks show 01HXX...
```

## Commands

```
ape-tasks login [email]                Paste-based login via browser.
ape-tasks logout                       Forget the token for current endpoint.
ape-tasks whoami                       Show current identity (--json).
ape-tasks teams                        List teams you belong to.
ape-tasks teams show <id>              Show team with members + plans.
ape-tasks teams new <name>             Create a team.
ape-tasks teams invite <team-id>       Generate a shareable invite URL.
ape-tasks teams invites <team-id>      List active invites.
ape-tasks teams revoke-invite <id>     Revoke an invite.
ape-tasks accept <url-or-token>        Accept an invite.
ape-tasks list [--team <id>]           List plans you can see.
ape-tasks show <id>                    Print plan body (or --json).
ape-tasks new --team <id> --title "…"  Create a plan.
ape-tasks edit <id>                    Edit body in $EDITOR.
ape-tasks status <id> <status>         Change status.
ape-tasks rm <id>                      Soft-delete.
ape-tasks docs [topic]                 Print embedded docs (agent, auth, cli, …).
```

Every command supports `--json`, `--quiet`, and `--endpoint <url>`. See
`ape-tasks <command> --help` for examples.

## For AI agents

`ape-tasks docs agent` prints a full agent-focused reference, including JSON
schemas, error codes, and multi-agent collaboration patterns via invites.

## License

[MIT](https://github.com/openape-ai/tasks/blob/main/LICENSE)
