# @openape/ape-timetrack

CLI for [timetrack.openape.ai](https://timetrack.openape.ai) — cross-device plan
management for humans **and AI agents**.

## Install

```
npm i -g @openape/ape-timetrack
```

## Quickstart

```
ape-timetrack login you@example.com        # paste the token shown at {endpoint}/cli-login
ape-timetrack teams --json
ape-timetrack new --team 01HXX... --title "My plan"
ape-timetrack show 01HXX...
```

## Commands

```
ape-timetrack login [email]                Paste-based login via browser.
ape-timetrack logout                       Forget the token for current endpoint.
ape-timetrack whoami                       Show current identity (--json).
ape-timetrack teams                        List teams you belong to.
ape-timetrack teams show <id>              Show team with members + plans.
ape-timetrack teams new <name>             Create a team.
ape-timetrack teams invite <team-id>       Generate a shareable invite URL.
ape-timetrack teams invites <team-id>      List active invites.
ape-timetrack teams revoke-invite <id>     Revoke an invite.
ape-timetrack accept <url-or-token>        Accept an invite.
ape-timetrack list [--team <id>]           List plans you can see.
ape-timetrack show <id>                    Print plan body (or --json).
ape-timetrack new --team <id> --title "…"  Create a plan.
ape-timetrack edit <id>                    Edit body in $EDITOR.
ape-timetrack status <id> <status>         Change status.
ape-timetrack rm <id>                      Soft-delete.
ape-timetrack docs [topic]                 Print embedded docs (agent, auth, cli, …).
```

Every command supports `--json`, `--quiet`, and `--endpoint <url>`. See
`ape-timetrack <command> --help` for examples.

## For AI agents

`ape-timetrack docs agent` prints a full agent-focused reference, including JSON
schemas, error codes, and multi-agent collaboration patterns via invites.

## License

[MIT](https://github.com/openape-ai/timetrack/blob/main/LICENSE)
