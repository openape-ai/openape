# Toolchain for a new session

Select the checkout and read its `package.json` first. It pins pnpm 10.29.3 and
requires Node >=22. The pnpm launcher on PATH may be a different version that
downloads the pinned version before executing even a local command.

## Prepare before a restricted session

In an environment already allowed to use the network and write its package
cache, verify the pinned version and locate the executable actually selected
inside the project:

```sh
node --version
pnpm --version
pnpm exec sh -c 'command -v pnpm'
```

The final command is a POSIX-shell example. Record its absolute result in the
local handoff. Verify that this executable reports the version in `package.json`.
It must be an already installed pnpm executable, not a launcher that needs a
network download. Keep its package files available for later sessions; cache
cleanup can remove them. Windows users must locate the corresponding executable
with their shell and apply the same version check.

Install dependencies with `pnpm install --frozen-lockfile` and build consumed
workspaces as described in [checks](checks.md). Preparation may need network and
filesystem access; it is separate from read-only diagnosis. Do not remove the
version pin, quarantine settings or sandbox restrictions to make diagnosis pass.

## Use the installed version in a restricted session

Prepend the verified executable's directory to PATH for the task's process.
For example, if the recorded executable is `/absolute/path/to/bin/pnpm`:

```sh
export OPENAPE_PNPM_BIN=/absolute/path/to/bin
export PATH="$OPENAPE_PNPM_BIN:$PATH"
command -v pnpm
pnpm --version
pnpm run doctor
pnpm check:affected --base origin/main --head HEAD --dry-run
```

Replace the example path with the recorded local path. Apply this environment
to each new tool shell, or use the task's existing environment setup mechanism;
exports do not necessarily persist between tool calls. Setting PATH also covers
Doctor/check child processes. Merely invoking `node scripts/doctor.mjs` still
uses the original pnpm on PATH for workspace inventory.

Use **`pnpm run doctor`**, not the built-in `pnpm doctor`. Require the actual
OpenApe JSON (`readOnly`, `root`, `checks`, `ok`) rather than exit code alone.
The dry-run describes the test scope; it does not execute those tests.

With network access already permitted, also run:

```sh
pnpm run doctor -- --network
pnpm git:cli -- repo
pnpm git:cli -- pr list
```

If the session has no network access, record these live checks as unavailable.
Offline Doctor success does not prove Forge/API connectivity. Keep live evidence
from another permitted environment clearly attributed to that environment.

## Diagnosed failure on 2026-09-07

[Issue #1343](https://git.openape.ai/openape-ai/openape/issues/1343) follows the
independent handoff from the workflow rollout. Homebrew pnpm 11.5.2 switched to
the project's 10.29.3. With network denied and pnpm cache writes denied, a local
`pnpm list` attempted `registry.npmjs.org/pnpm/-/pnpm-10.29.3.tgz` and failed.
Network denial alone did not reproduce the failure with the warm cache.

Using the installed 10.29.3 directly on PATH allowed the project Doctor and
affected-check dry-run under both restrictions. No Codex permission change or
global pnpm downgrade was needed. This is an observed launcher/cache failure,
not evidence that repository tests or the native Forge are broken.
