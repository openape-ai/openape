# Develop Pods with ape-pods

`ape-pods` is a standalone Node CLI for listing, creating, editing and running
Pods. It uses the real selected Pods profile and the existing execution core.
It does not build, package, notarize, install or start Electron.

## Build and install locally

From the monorepo root:

```sh
. ./scripts/activate-node.sh
pnpm run doctor
pnpm --filter @openape/pods build:runtime
node apps/openape-pods/dist/cli/entry.cjs --help
```

The runtime build prepares the worker, native helpers, pinned ape-shell/Codex
assets and script runtime. It omits the Electron main/preload and Vue renderer.
It requires the pinned Node/pnpm versions, installed workspace dependencies and
macOS Command Line Tools. Native execution retains the existing verified macOS
and Apple silicon support boundary.

The package exposes `ape-pods` through its `bin` entry. To use this checkout
directly, create a local link once, without replacing an existing command:

```sh
mkdir -p "$HOME/.local/bin"
ln -s "$PWD/apps/openape-pods/dist/cli/entry.cjs" "$HOME/.local/bin/ape-pods"
ape-pods --help
```

Keep the checkout while the link is in use. Rebuild the runtime after changing
runtime source; editing a Pod script does not require another runtime build.

## Select the real database

The default base is `~/Library/Application Support/OpenApe Pods`. The CLI honors
its `selected-profile.json`, so desktop and CLI refer to the same Pod IDs,
metadata, script history, checkpoints and shared data. `--profile /absolute/path`
selects another profile explicitly; no database copy or temporary substitute is
made by the CLI.

**Close the desktop for the entire CLI command.** This initial version has no
desktop attachment protocol. An active desktop `SingletonLock` is refused
without removing it. Standalone CLI workers also hold an OS profile lock until
their child processes and database have closed. Do not start the desktop while
a command is running: the installed desktop does not participate in that lock.

## The four commands

```sh
ape-pods list
ape-pods list --json
ape-pods create --name "One small task" --tags development
ape-pods edit POD_ID --name "Revised name" --tags development,tested
ape-pods edit POD_ID --tags ''
ape-pods edit POD_ID --lifecycle paused
ape-pods edit POD_ID --script /path/to/pod-script.mjs
ape-pods run POD_ID
```

Use the full ID or an unambiguous prefix of at least eight characters. `create`
always creates a paused Pod. `create` without a name and `edit` without changes
prompt only in a terminal. Automated calls must pass their inputs explicitly.
An empty `--tags` value clears tags. Metadata edits use the current revisions
and preserve fields that were not requested.

An optional `--script` on `create` or `edit` imports the canonical
`pod-script.mjs` through draft → dependency preparation → validation → activation.
It never executes that source as a raw unconfined Node script. Failed validation
keeps the previous active version; the new draft and earlier metadata changes
remain available for inspection. A newly created Pod remains paused and its ID
is emitted on stderr even if subsequent script setup fails.

Runs require the existing owner/Pod identity setup and authorization. A profile
without that setup can still list, create and edit metadata. Creating a record
does not manufacture an unauthenticated identity or grant. Existing configured
identity provisioning remains responsible for binding a new Pod.

## Identity, context and storage

`run` executes only the requested active validated script, waits for its durable
result and prints progress. It starts no schedules or sibling Pods. Ctrl+C
cancels that run and waits for runtime cleanup. Unknown external effects retain
their recovery state; the CLI does not replay them automatically.

The DDISA principal is the Pod, with existing exact-command grants through
ape-shell. The stored execution level selects the home context: `owner` uses
the owner's home and permitted existing application configuration/logins;
`isolated` uses the Pod home and assigned resources. The working directory stays
the Pod workspace. The caller's shell environment is not inherited wholesale.
Protected profile, control-socket, owner apes-login and denylist paths remain
closed in both contexts.

Existing Pod identity records use the current encrypted store. A minimal macOS
adapter reads the existing Safe Storage key without creating or changing a
keychain item or displaying a system prompt. A missing, locked or denied item
fails explicitly. This release adds no credential-management commands and
refuses `context.credentials.get` for additional assigned script secrets.

Shared domain data and work use the existing runtime APIs with Pod-scoped
reader/writer permissions, revisions and claims. Owner HOME does not grant owner
administration rights over those records. The future move toward Pod-owned
storage is separate from this CLI: each Pod should own a small responsibility
and remain individually executable; no storage migration happens here.

## Output and exit codes

`--json` emits one final JSON value on stdout; progress and diagnostics go to
stderr. Run results include the durable run ID, state, summary and error.

| Code | Meaning |
| --- | --- |
| 0 | Command succeeded; run completed or completed with gaps |
| 1 | Run failed, blocked or was interrupted |
| 2 | Invalid command, missing Pod or missing required input |
| 3 | Runtime, storage, identity or infrastructure unavailable |
| 130 | Run or interactive input cancelled |

## Verify CLI changes

Use the existing suites after the runtime build:

```sh
pnpm --filter @openape/pods test --maxWorkers=4 test/main/cli.test.ts
pnpm --filter @openape/pods exec vitest run --config vitest.electron.config.ts e2e/cli.test.ts --maxWorkers=1
```

Despite its historical config name, the focused native suite runs in Node and
launches no Electron process. Its existing global setup builds the pinned O365
test helper and therefore requires the pinned Go toolchain. Native fixtures use
disposable real-schema databases and a local signed IdP; they never run owner
Pods or touch the real owner's keychain/login files. Fixture identity evidence
does not establish acceptance against a live external identity provider.
