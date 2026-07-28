# @openape/ape-plans

CLI for [plans.openape.ai](https://plans.openape.ai) — cross-device plan
management for humans **and AI agents**.

## Install

```
npm i -g @openape/ape-plans
```

## Quickstart

```
ape-plans login you@example.com        # paste the token shown at {endpoint}/cli-login
ape-plans teams --json
ape-plans new --team 01HXX... --title "My plan"
ape-plans show 01HXX...
```

## Commands

```
ape-plans login [email]                Paste-based login via browser.
ape-plans logout                       Forget the token for current endpoint.
ape-plans whoami                       Show current identity (--json).
ape-plans teams                        List teams you belong to.
ape-plans teams show <id>              Show team with members + plans.
ape-plans teams new <name>             Create a team.
ape-plans teams invite <team-id>       Generate a shareable invite URL.
ape-plans teams invites <team-id>      List active invites.
ape-plans teams revoke-invite <id>     Revoke an invite.
ape-plans accept <url-or-token>        Accept an invite.
ape-plans list [--team <id>]           List plans you can see.
ape-plans show <id>                    Print plan body (or --json).
ape-plans new --team <id> --title "…"  Create a plan.
ape-plans edit <id>                    Edit body in $EDITOR.
ape-plans status <id> <status>         Change status.
ape-plans rm <id>                      Soft-delete.
ape-plans docs [topic]                 Print embedded docs (agent, auth, cli, …).
```

Every command supports `--json`, `--quiet`, and `--endpoint <url>`. See
`ape-plans <command> --help` for examples.

## For AI agents

`ape-plans docs agent` prints a full agent-focused reference, including JSON
schemas, error codes, and multi-agent collaboration patterns via invites.

## License

[MIT](https://github.com/openape-ai/plans/blob/main/LICENSE)
