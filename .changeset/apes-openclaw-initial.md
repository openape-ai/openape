---
"@openape/apes-openclaw": minor
"@openape/apes": patch
---

New `apes openclaw` subcommand: `apes openclaw add <agentId>` enrols a
per-agent DDISA identity, sandboxes that OpenClaw agent completely, mounts its
identity read-only into the container, and maps it to the `openape-grant-gate`
plugin — so the only way onto the host is an elevated exec, and every elevated
exec becomes a grant request made as that agent.

External subcommand dispatch now runs before citty's builtin help handling, so
`apes <sub> --help` reaches the child. Installed executables can never shadow a
builtin command.
