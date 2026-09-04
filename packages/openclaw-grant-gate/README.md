# @openape/openclaw-grant-gate

OpenClaw plugin that routes every agent `exec` through the DDISA grant flow.

Each command an agent wants to run becomes a grant request made with **that agent's**
operator identity. The command runs only once the grant is decided. Approvals are made
with the **owner's** identity — an agent can request, it can never approve itself.

## Why a hook and not a shell

Setting `SHELL=ape-shell` does not gate an OpenClaw agent. `getBashShellConfig()` in
OpenClaw hardcodes `/bin/bash` and never reads `$SHELL`, so the session bash tool bypasses
a shell-level gate entirely. This plugin registers on `before_tool_call`, which wraps the
tool *definition* — no shell-resolution path can get around it.

## Install

```bash
npm i -g @openape/openclaw-grant-gate
```

Point OpenClaw at it and map each agent to its apes auth home:

```json
{
  "plugins": {
    "load": { "paths": ["/path/to/@openape/openclaw-grant-gate"] },
    "entries": {
      "openape-grant-gate": {
        "enabled": true,
        "config": {
          "agents": { "my-agent": "/path/to/agent/auth/home" },
          "apeShellPath": "/usr/local/bin/ape-shell"
        },
        "hooks": { "timeouts": { "before_tool_call": 600000 } }
      }
    }
  }
}
```

`agents` maps an OpenClaw agent id to the directory containing `.config/apes/auth.json`
for that agent's operator identity.

## Fail-closed

Every uncertainty rejects the tool call: an agent with no mapped identity, a malformed
config, a hook timeout, an unreachable IdP. This matches OpenClaw's own default for
`before_tool_call` and is not configurable — a gate that fails open is not a gate.

## Publishing

Publish the **packed tarball**, never the folder:

```bash
pnpm --filter @openape/openclaw-grant-gate pack --pack-destination /tmp
clawhub package publish /tmp/openape-openclaw-grant-gate-<version>.tgz \
  --owner openape \
  --source-repo openape-ai/openape \
  --source-commit "$(git rev-parse HEAD)" \
  --source-path packages/openclaw-grant-gate
```

`clawhub package publish .` packs the working directory verbatim, including
this package.json's `workspace:*` and `catalog:` dependency protocols. Both are
pnpm-only, so the release would publish successfully and then fail to install
for everyone. `pnpm pack` rewrites them to the published versions first.
