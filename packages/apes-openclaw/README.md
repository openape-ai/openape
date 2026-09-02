# @openape/apes-openclaw

`apes openclaw` — set up an OpenClaw agent that runs sandboxed and asks for a
DDISA grant before it can escape onto the host.

```bash
npm i -g @openape/apes-openclaw
apes openclaw add iurio
```

`apes` finds this package as `apes-openclaw` on the PATH; there is no plugin
registry to register with.

## What `add` does

1. Creates `~/agent-identities/<agentId>/` and enrols an agent identity into it
   by running `apes enroll` with `HOME` pointed at that directory. The agent's
   key, `auth.json` and `config.toml` stay together there, and your own
   `~/.config/apes` is untouched.
2. Patches `openclaw.json` (via `openclaw config patch --stdin`) so the agent
   runs fully sandboxed, mounts its identity read-only at
   `/home/sandbox/.config/apes`, and is mapped to that identity in the
   `openape-grant-gate` plugin.
3. Recreates the sandbox so the new mounts take effect.

Afterwards the agent cannot reach the host at all except through elevated exec,
and every elevated exec becomes a grant request made as *that agent*.

## Options

| Flag | Meaning |
| --- | --- |
| `--home <dir>` | Root for identity homes (default `~/agent-identities`) |
| `--image <ref>` | Sandbox image (default `ghcr.io/openape-ai/apes-sandbox:latest`) |
| `--bind <spec>` | Extra host folder, `host:container:mode`, repeatable |
| `--dry-run` | Print the config patch, write nothing |
| `--skip-enroll` | Assume the identity already exists |

Give an agent its own scoped credentials with `--bind`. Mounting only one
account's credential is what actually stops the agent from using another —
an argv allowlist cannot:

```bash
apes openclaw add iurio --bind ~/agent-identities/iurio/o365:/home/sandbox/.o365-cli:rw
```
