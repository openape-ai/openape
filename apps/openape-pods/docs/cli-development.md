# Develop Pods with ape-pods

`ape-pods` is a standalone Node CLI for listing, creating, editing and running
Pods. It uses the real selected Pods profile and the existing execution core.
It does not build, package, notarize, install or start Electron.

## Build and install locally

From the monorepo root:

```sh
. ./scripts/activate-node.sh
pnpm run doctor
pnpm install --frozen-lockfile
pnpm exec turbo run build --filter='@openape/pods^...' --concurrency=1
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

A manual `run` also verifies the owner's current `apes` login. That explicit
owner call authorizes one start of the selected script through an exact
single-use IdP grant, including the runtime and script content. It does not
approve downstream programs or scheduled runs. Their existing grants, sandbox
constraints and recovery holds still apply. Pending downstream approvals are
printed on stderr; the CLI does not open browser windows automatically.

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

Pod execution identities use private `credentials/<connection-id>.identity.json`
files shared by desktop and CLI. The credential directory is mode `0700` and each
identity file is `0600` on supported Unix hosts. The trusted runtime reads the
permanent key; ape-shell receives the existing short-lived token file. Pod
programs remain unable to directly read or write the protected profile.

Open the updated desktop once before using an existing profile with this CLI.
It decrypts legacy Pod identity records through its original Safe Storage access,
atomically writes the private identity file, and only then removes that identity's
old encrypted record. Keys, subjects, references and grants are preserved. Failed
migration preserves the encrypted source; the CLI reports the migration requirement
without accessing the keychain or generating a replacement identity. Fresh Pod
identities use the file format immediately. Older desktop versions do not understand
the new format; rollback requires restoring a consistent pre-migration profile
backup while both runtimes are closed, not reinstalling the old binary alone.

Only Pod execution identities move. Provider credentials, assigned application
secrets, owner login and relay registration retain their existing protection. This
release adds no credential-management commands and refuses
`context.credentials.get` for additional assigned script secrets. The CLI cannot
use application credentials which require desktop decryption.

Owner-level assigned program calls and application terminals use the owner HOME
and temporary working files without opening or updating private ProgramState.
They do not append a private-state cache-directory argument. Isolated programs
retain their encrypted application state; making that state usable by the CLI
without an OS keychain is tracked separately in issue 1500.

This is filesystem and sandbox protection, not encryption at rest: unsandboxed
processes running as the owner can read these identities. Owner mode already means
trust in the Pod code; its direct path denials do not prevent indirect execution
through owner startup files. The storage format has no OS-keychain dependency;
this change does not add Windows or Linux runtime/sandbox support.

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
