# @openape/apes-openclaw

## 0.1.0

### Minor Changes

- cf2d089: New `apes openclaw` subcommand: `apes openclaw add <agentId>` enrols a
  per-agent DDISA identity, sandboxes that OpenClaw agent completely, mounts its
  identity read-only into the container, and maps it to the `openape-grant-gate`
  plugin — so the only way onto the host is an elevated exec, and every elevated
  exec becomes a grant request made as that agent.

  External subcommand dispatch now runs before citty's builtin help handling, so
  `apes <sub> --help` reaches the child. Installed executables can never shadow a
  builtin command.

### Patch Changes

- 9fbd8c1: Fix three ways the generated agent could be set up wrong:

  - The identity mount was read-only all the way down, so `@openape/cli-auth`
    died with `EROFS` writing the exchanged SP token into `sp-tokens/` — the
    first authenticated call from the sandbox failed. `sp-tokens/` now gets a
    writable overlay while `auth.json` stays immutable.
  - The enrolment key was never mounted, so once the agent token expired
    challenge-response refresh had nothing to sign with.
  - Setup enabled elevated exec without checking that `openape-grant-gate` is
    installed. OpenClaw ignores a `plugins.entries` record for a missing plugin,
    which would have left the agent with a host escape and no gate. Setup now
    refuses unless the plugin is loadable, and restarts the gateway so the
    patched plugin config is actually live before success is reported.

- 5018007: Add the public agent sandbox image (`compose/apes-sandbox.Dockerfile`,
  `scripts/publish-sandbox-image.sh`): a Node 22 Debian base with the apes CLIs
  pre-installed, running as the non-root `sandbox` user that OpenClaw's bind
  targets assume. Account-specific tooling stays in a local `FROM` layer.
