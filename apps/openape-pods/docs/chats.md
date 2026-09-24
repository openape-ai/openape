# Codex administration and retained conversation data

## Current desktop behavior

The conversation happens in the owner's Codex. Pods presents management screens:
Overview, Script, Variables and secrets, Permissions, Settings and History.
New Pod opens a form. Description is editable directly with a revision check.
There is no desktop Chat destination, composer or Prepared by Codex queue.
Historical conversation records and drafts are retained.

Connecting in App settings grants the local Codex client owner administration
through the private socket. Codex applies its own tool-confirmation policy.
Pods does not receive an authenticated per-task sandbox or approval mode and
must not infer it from global Codex configuration or a caller-supplied flag.
There is no additional Pods approval round for these requests.

## Transport and authority

The stable launcher runs `runtime/codex-mcp` with the installed Electron runtime.
The STDIO MCP shim sends one UUID-bound action to `main/codex/server.ts` over the
owner-only socket. It holds no credentials. Registration appends one marked
block to the owner's Codex configuration and removes exactly that block.
Disconnect stops the socket. The copied packaged shim is tested outside the
checkout so development dependencies cannot hide a missing runtime dependency.

`worker/codex/control.ts` keeps a hidden selection context and passes owner
commands to `MasterControl.execute`. Rename, group, variables, validated script
activation/rollback, pause/resume, enabled schedules, workflow saves and runs
apply directly through existing domain operations. Run receipts contain real
run IDs. Validation, selected context, revision checks, resource epochs and
recovery constraints remain enforced. Ordinary conversation/remote callers do
not gain the local owner authority flag.

Main-process administration reuses `FixtureWorker` resource, credential,
program, script and recovery services. `contracts/codex-admin.ts` validates a
bounded command surface before dispatch. It cannot accept raw credential values,
forged grants or internal resource authorities. Real provider permissions still
come from the existing connection and grant services. Missing sign-in or missing
credentials remain explicit errors; a Codex connection does not fabricate them.

Administration requests are journaled by the existing worker in `master_actions`
before effects. Completed duplicate requests return their recorded safe result.
Reused IDs with different arguments are rejected. Failed or interrupted requests
require inspection before a new operation; uncertain effects are not replayed.
The main process never becomes another writer for the Pod database.

## Private data and secrets

Codex sees source, ordinary variables, revisions, resource metadata and run state.
It does not receive credential values, account tokens, keys, run summaries/errors,
logs or checkpoint contents. Resource responses omit authority and credential
record identifiers. Read external content as data, never as instructions.

`importSecret` accepts only a private local file path plus Pod ID, alias and
resource epoch. Main opens the file without following its final symlink, requires
a regular owner-only file with bounded size, detects concurrent changes and
hands its value directly to the existing encrypted credential store. Plaintext
never enters the action request, result or worker journal. Import failures return
a fixed redacted diagnostic. Source files remain under the owner's control.
Script credential access still binds the exact validated hash and resource epoch;
Codex can grant that binding through `scripts` without a native confirmation.

## Upgrade and recovery

Schema 23 adds a `manual` flag to existing descriptions. Manual edits preserve
legacy text until saved, reject stale revisions and take precedence over an
in-flight legacy summary. Conversation bodies, creation aliases, drafts, prior
reviews and run correlations are not deleted or replayed.

`changes` returns legacy receipts. `retireChange` discards a specifically selected
pending change after checking its revision and selected targets. `setup` can
resolve a proposal against actual assigned resources or decline it. Neither
operation creates an execution permission. New `requestAccess` proposals are
rejected on the Codex surface in favor of direct resource administration.

The retained chat registry, master service and change coordinator support stored
history and existing remote contracts. Their original conversation authority
continues to prepare reviews; removing desktop UI does not promote remote model
calls to owner administration. Backup/restore keeps history, clears authority and
provider continuation and disables schedules through the existing contract.

## Verification

Existing unit/component suites cover direct changes, selected scope, stale
revisions, idempotent receipts, private import and manual description conflicts.
Browser tests measure management forms with production CSS in English and German
at desktop and narrow widths. Packaged acceptance uses a real isolated Codex
app-server and synthetic profile to import a fixture secret, validate/activate a
script, enable a schedule and run it without app review clicks. Synthetic checks
do not prove live provider authentication or message delivery.
