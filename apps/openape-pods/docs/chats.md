# Central Chats

Chats is a sidebar destination alongside Pods and Workflows. New chat opens a
workspace conversation immediately. Use **+** beside the message box to choose
Pods and optionally one workflow. Selected context stays visible as removable
chips. The current model is shown beside + in the composer. Click it or type `/`,
then choose `/model` to open the same searchable model list. Arrow keys and Enter
select; Escape closes the list. A completed selection removes only the command
token and keeps the rest of the draft. Recognized model commands never become model requests,
normal paths remain message text, and model changes wait for the active response.
The existing saved model preference and model catalogue remain unchanged.

Each Pod's Chat tab and History link to the same related conversations;
a workflow exposes its related chats. The original Pod chat remains available.

Workspace context exposes catalogue metadata, not arbitrary saved Pod content.
Tool targets are checked by the receiver against the conversation's current
context revision. Selecting a workflow pins its definition and member Pods; it
never modifies Pod membership, identity, lifecycle or schedules. Later workflow
edits require explicit refresh through +. A directly selected Pod remains when
the workflow is removed. Removing a workflow-derived member detaches the
workflow, with the remaining Pods shown as direct selections before confirmation.

Any confirmed context change starts a fresh provider thread. The old transcript
remains readable, including paginated earlier messages and context markers, but
is not replayed or automatically summarized into the new model context. Context
changes wait until the active response and its tools have settled. Only one
embedded model response runs at a time. Navigation does not cancel it.

## Saved changes and execution

Scripts are saved as independently identified drafts before validation. The saved Pod draft catalogue is shared state available to selected chats, while transcripts, composer buffers and change reviews belong to their conversations. Configuration and activation
requests prepare one pending change set for the conversation/context revision.
The review includes every target, before/proposed values or code and validation
evidence. Draft progress and failures come from saved records, not assistant
claims. Credential, dependency and resource approvals retain their existing
owner forms and exact-code decisions.

**Apply changes together** checks all targets and commits local changes and their
receipts in one SQLite transaction. It checks context, Pod/configuration/resource
snapshots, draft hashes, proposed-variable validation, workflow revisions and
existing run/program/workflow/effect/input fences. A failure on any target changes
none. Already granted permissions and saved drafts remain. A stale proposal can
be inspected and discarded, then prepared again from current state; no automatic
rebase hides a concurrent edit. Repeated application of an applied review returns
the saved result; a contradictory decision is rejected. Historical receipts are marked when configuration changed later. New proposals get a new review identity.

New schedules remain disabled. Chat cannot enable or resume automation; changing
activation belongs to ordinary owner settings. Replacing an enabled Pod schedule
requires separate owner review there. Workflow proposals preserve schedule
activation, and enabled schedules cannot be silently replaced.

**Run once** is separate. A model run action records a request; only the owner
button accepts it. The existing dispatcher or workflow engine creates the actual
run. Run IDs are correlated at reservation time, and chat displays current run
states and links to their traces. A stopped response does not stop an accepted
run. Interrupted or uncertain execution is inspected through existing recovery;
it is never automatically replayed by the chat coordinator. No external effect
belongs to the local configuration transaction.

## Storage and compatibility

Schema 21 adds `chat_conversations`, `chat_contexts`, `chat_members`,
`chat_message_context`, `chat_active`, `control_changes` and `control_runs`.
The existing migration mechanism backs up the prior database first. Original
message IDs, bodies, ordering, creation aliases, drafts, approvals and action
records remain. `master_contexts` holds the current provider segment, while a
context revision retains the retired thread reference. The legacy broad workspace
thread is retired on upgrade. Existing scoped Pod threads retain their narrow
context. Old creation/adoption routes still resolve to the original conversation.

Deleting a Pod retains its historical conversation membership and messages.
Unavailable context is shown explicitly and cannot be used as a mutation target.
Restore clears provider continuation and authority, invalidates pending reviews,
keeps history and disables existing schedules through the backup contract.

`contracts/control-api.ts` defines change reviews/receipts;
`worker/control/changes.ts` coordinates them over existing domain operations.
The renderer reaches these operations through the authenticated owner-window IPC
in `main/app.ts` and `FixtureWorker`. Embedded model calls pass a server-derived
conversation scope.

The owner's locally installed Codex reaches the same writer (issue 1375):
`runtime/codex-mcp` is a STDIO MCP server started by a stable launcher, and
`main/codex/server.ts` forwards one `pods_control` action per line to
`worker/codex/control.ts`. That executor runs in a hidden conversation scope that
is not listed under Chats. Renaming, grouping, pausing and preparing a disabled
schedule apply directly. Activation, rollback, variables, workflow saves and runs
stay change sets that the owner applies under **Prepared by Codex**, which renders
the same `ChangeReview` and `AccessProposals` components as the chat. Codex gets
run state only, no run summaries, run errors or checkpoints. Apply, discard and
approval have no representation on the socket. Registration appends one marked
block to the owner's `config.toml` and removes exactly those bytes again.

## Verification

The existing component and native Electron suites cover the + picker, context
scope/refusal, fresh provider threads, preserved history, atomic multi-Pod apply,
concurrent changes, owner-run requests and real synthetic run receipts. Layout
checks use packaged Electron CSS at 1060, 760 and 560 pixels. Fixture profiles and
local synthetic providers are separate from owner data. Full final-source check
results and the native PR are recorded in `docs/agents/active-work.md`.
