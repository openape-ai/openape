# OpenApe Pods · User handbook

[Deutsch](handbook.de.md)

Your pods, their scripts and the evidence they keep.

Generated from handbook.json. Screenshots use the packaged app with synthetic data.

## Start here

Choose a pod in the sidebar, then use Overview, Chat, Script, Permissions, Settings and History. Drag the sidebar divider or focus it and press Left/Right to resize; collapse it with the arrow button. Width is saved on this Mac.

This handbook covers the unsigned 0.1.0 development app. Screenshots use synthetic orders and local reference files. Actual ChatGPT/OpenApe/Microsoft sign-in, live mail and signed distribution still need release acceptance. Runtime execution currently requires Apple Silicon and Darwin 25.6.0, verified on macOS 26.6.2. An unsupported host displays an error and blocks execution.

The app bundles Electron, Node.js and Codex. You do not need a separate Node installation for packaged runs. Mount the supplied DMG and copy OpenApe Pods to Applications. An unsigned test build is subject to macOS security review; it is not a notarized release.

Closing the window keeps the app available through its menu-bar presence. Quitting stops local execution; the Mac cannot run schedules while asleep. Reopen the app to inspect interrupted work. Normal data lives in ~/Library/Application Support/OpenApe Pods.

## Choose your language

Open App settings in the sidebar and use Language to switch between Deutsch and English. Your choice is saved per local profile and applies to the interface, native menus and app-owned dialogs. Unsaved editor content is retained when navigating there.

Pod and group names, assignments, knowledge, sources, conversation messages, script code and technical audit payloads stay in their original language. The switch does not translate your content or change model prompts. Known app diagnostics are translated; an unknown external diagnostic is labeled and retained exactly. Dates and numbers follow the selected display language; stored times, schedule time zones and script contracts remain unchanged.

The handbook is available as complete English and German offline editions with matching app screenshots. Use the link to the other edition in the handbook navigation. Keep both HTML files together when using those links. The language preference is local display configuration; a restored profile starts from its system default until you choose again.

## Your first local run

Try this with a new pod. The local example needs no account connection and increments a durable counter. Installing an example also makes that example the active script, so use your new pod rather than replacing a configured business script.

1. Choose New pod, expand Create without chat, enter Pod name and Assignment, and Save pod.
2. Open Script. The starter already returns a valid local result; edit its summary if desired.
3. Choose Save and run. Validation uses synthetic services; the real local run then starts without any account connection.
4. Inspect History and the completed result. Select a run to inspect persisted events.
5. Return to Overview for the last result. Automatic execution remains disabled.

## Organize pods in groups

Use groups in the sidebar to organize related pods. Every pod belongs to one flat group or Ungrouped. Group names, membership and collapsed state are saved on this Mac and included in backups. Groups appear in creation order; pods keep their original creation order within each group.

Grouping does not share resources or permissions, change an assignment, invalidate a script or alter a running task. New pods begin in Ungrouped. Removing a group keeps every pod; deleting a pod remains a separate Data & backups action.

1. Choose + Group beside YOUR PODS, enter a Group name and choose Create group. Names contain 1–100 characters; up to fifty groups are supported.
2. Select a pod, open Settings and choose Group. Dragging a pod onto a sidebar group also works.
3. Choose a group heading to collapse or expand it. The selected pod stays open in the workspace while its group is collapsed.
4. Choose the three-dot button beside a group to rename it. To remove the group, choose Remove group and confirm that its pods move to Ungrouped.
5. If another edit changed the groups, keep your entered text, wait for the sidebar to refresh and try again.

![Organize pods in groups](images/handbook-groups.png)

## Overview

Overview shows the description, the latest execution and its result. Expand Edit description to change the task. Saving pauses automatic execution and advances the assignment revision.

Run now starts the active, reviewed script. Prepare a new or changed script in Script first. An active run, unavailable execution slot, changed script or pending recovery prevents an immediate reviewed run.

View run trace opens History. Results and sources opens the retained knowledge view within Overview, including findings, questions, gaps and exact citations.

![Overview](images/handbook-overview.png)

## Chat and pod creation

Every pod has a Chat tab with its own persisted history and Codex continuation thread. Ask the assistant to prepare the assignment, script and required access. New pod starts the creation chat; Create without chat exposes the local form.

The assistant can prepare, validate and activate scripts within existing assignments and permissions. Additional access and secret approval remain owner decisions. It cannot enable schedules. Only one assistant turn runs across the app at a time; cancel or finish it before starting another pod conversation.

Cancel turn interrupts the active conversation; Steer adds an instruction to that turn. Text typed while a message is sending is retained. The regular script agent uses fresh context and does not automatically receive this chat, variable values or secrets.

App settings → Workspace chat retains the previous global conversation and supports workspace-wide creation. Pod chats provide separate histories and model threads, while using the existing owner-authorized master control capabilities.

![Chat and pod creation](images/handbook-chat.png)

## Inspect and edit your script

The Script tab opens the current saved working source, including a newer saved draft. V1 has no version browser, comparison or rollback controls. Internal immutable script hashes, validation, credential approval and run pinning remain enforced.

The highlighted JavaScript editor supports line numbers, horizontal scrolling, two-space Tab indentation, Escape followed by Tab to leave, and Cmd+S (Ctrl+S) to save. Source is rendered literally and is not executed in the renderer.

Unsaved script, ordinary variable, settings and chat text survive navigation within this app session. Save before quitting. Reload script asks before discarding changed text. If a concurrent change causes a conflict, reload the current source or explicitly save your edits as the current script.

Available variables and secrets expands a reference list with copyable access expressions. Secret values stay hidden. Manage variables and secrets opens their Settings section. Required access declares only capabilities already assigned to the pod.

1. Edit the source and choose Save script to persist it without running.
2. Choose Run or Save and run. The app saves and validates changed source in the existing sandbox with synthetic services. A failed check preserves the source and leaves the previously active script intact.
3. If secret access is required, review the full source and choose Review credential access. The native confirmation names the pod, exact SHA-256 and requested aliases. Cancelling keeps execution blocked.
4. After successful validation and any required owner approval, the app activates that exact source and starts it. History shows the result. This does not enable automatic execution.

![Inspect and edit your script](images/handbook-script.png)

## Concurrent edits and recovery

If a chat or another edit changes the saved script while your editor contains unsaved work, the app retains your text and rejects a stale save. Reload script lets you discard your local edits after confirmation. Save my changes as current script explicitly preserves your text as a new working artifact; it still requires validation and any credential approval before running.

Reloading an unchanged editor picks up the current saved source. Saving does not start a run. A Run request rejects a changed active script, an occupied execution slot or pending inputs rather than silently executing different code later.

## Permissions

Permissions lists assigned files and tool/application access with their scope and state. General GUI app and terminal launch is still unavailable because the execution containment gate is unresolved. This screen does not grant unrestricted host execution. Secret values are managed in Settings.

Choose a reference file through the native file picker. The pod receives a read-only snapshot; the original stays outside its writable workspace. Each run records the reference version it used. A changed original becomes input for a later run.

Capture a snapshot to inspect its recorded digest. Revoke an assignment to remove its permission. Resource changes invalidate older validation evidence and can stop affected execution; review and validate a script against the new scope.

Manage accounts and mail scope opens Connections & setup. A capability declared in a script is a request to use existing permissions, not permission to access an account.

![Permissions](images/handbook-permissions.png)

## Settings and assignments

Settings contains the pod name, group, automation and interval, Variables and secrets, and additional lifecycle options. Edit the description from Overview. Saving the name or description pauses automatic execution; revalidate the script for the changed assignment.

Ordinary variables are named strings stored in SQLite for this pod. Use context.variables["name"] in scripts. Up to 32 variables are supported, with values up to 2,048 characters. Values are captured for each run; later edits apply to future runs. These values are not encrypted. Store sensitive values as secrets.

Expand More options to archive the pod or delete an archived pod through a separate native confirmation. Deletion removes its variables and pod chat as well as local data. Workspace chat, shared accounts and original reference files remain.

![Settings and assignments](images/handbook-settings.png)

## History and recovery

History lists persisted execution states and summaries. Select a run to inspect its pinned script version, checkpoint, error and ordered Persisted events. The local example is deterministic; the agent example additionally needs a connected Codex provider.

Cancel stops an active run. Interrupted work remains visible after a crash or restart. Choose Check stopped execution to reconcile the previous execution, then Retry remaining inputs when the result permits it. If the outcome needs review, resolve that uncertainty before retrying. Retry unstarted inputs becomes available for a blocked queue.

At most one run executes per pod. Additional accepted inputs stay queued. Distinct events are preserved, while missed schedule occurrences are coalesced into one catch-up. Checkpoints record successful progress; resuming a Codex thread alone is not a recovery decision.

Changing the script only affects subsequent runs and does not undo earlier results or effects. Internal script hashes remain in execution details for auditability.

![History and recovery](images/handbook-history.png)

## Results and sources

Knowledge contains durable statements with supporting evidence. Findings describe supported business facts. Open questions need a business answer. Verification gaps identify missing or unreadable evidence; a gap is not automatically an unanswered business question.

Filter by kind, and enable Include superseded history to inspect earlier statements. Current statements can replace earlier ones while retaining their source history. Additional entries are paginated.

Expand an entry and choose its source to view the retained content, version and digest. Extracted text can link to its retained original. Long source previews are explicitly marked as truncated. Source text is displayed literally.

Use the contextual discussion action to ask the master about the selected pod. Statements and source history stay in the pod independently of the chat.

![Results and sources](images/handbook-knowledge.png)

## Use credentials in your pod script

Each pod owns its script versions, workspace, persistent checkpoint and credential assignments. Under Resources, enter a Credential alias and a masked Credential value, then choose Save or replace credential. An alias starts with a lowercase letter and contains at most 64 lowercase letters, digits, underscores or hyphens. Values contain 1–16,384 characters without null bytes. Each pod supports 32 current aliases; a script can declare up to 16 capabilities including mail.read.

Values are encrypted with macOS safeStorage under the active application profile’s credentials directory. Resource records and editor history contain aliases and opaque IDs, never the automatically supplied value. Two pods may use the same alias with different values. Existing shared ChatGPT, Microsoft and OpenApe authentication tokens remain managed by their connection broker; this API does not extract them.

await context.credentials.get('crm') returns the string assigned to this pod and alias. Declare credential.crm by selecting crm in the editor. The runtime verifies the current run lease, exact script version, assignment revision, resource revision and owner approval before and after reading. Codex has no credentials.get tool. Values are not automatically added to input.json, environment, AI prompts or run logs.

A script that can read a secret can explicitly put it into a prompt, log, checkpoint or file. Review the full source before granting access. Synthetic validation checks the execution contract with synthetic-credential-<alias> values; it cannot establish that source is safe for every input. A later model call receives whatever prompt the script constructs. Files written by the script and their contents may be included in backups.

Saving or replacing a credential pauses the pod and invalidates prior validation and credential approval. Revoking it cancels affected work and removes its encrypted value. After restore, assign secret values again and revalidate and approve scripts; managed secret values and their recovery records are excluded from backups. An interrupted save is reconciled on restart. New versions prepared by the master cannot grant themselves credential access.

The example below combines normal Node file IO, durable variables, an explicit credential read and a separate AI call. It deliberately keeps the credential out of the prompt. It requires an assigned crm alias, exact-version approval and a connected model for real execution. Validation uses a synthetic model response. Direct network access and launching child programs remain restricted by the existing runtime; declaring a credential does not grant either.

1. Open Settings → Variables and secrets. Enter the secret alias and value, then save. The masked field clears after submission, including failures.
2. Open Script, expand Required access and select the required aliases. Use await context.credentials.get("alias") in the source.
3. Choose Save and run. After synthetic validation, review the source and confirm Review credential access in the native dialog.
4. History shows the run. Source, assignment or resource changes require renewed validation and secret approval.

```javascript
import { readFile, writeFile } from 'node:fs/promises'

export async function run(context) {
  const credential = await context.credentials.get('crm')
  if (!credential) throw new Error('Assigned credential is empty')

  const notes = context.input.checkpoint.notes ?? 'Review synthetic notes'
  await writeFile(context.workspace + '/notes.txt', notes)
  const text = await readFile(context.workspace + '/notes.txt', 'utf8')
  const answer = await context.agent.run({ prompt: text })
  await writeFile(context.workspace + '/review.txt', answer.response)

  await context.progress.commit({
    expectedRevision: context.input.checkpointRevision,
    checkpoint: { ...context.input.checkpoint, reviews: (context.input.checkpoint.reviews ?? 0) + 1 },
    sources: [],
    claims: [],
  })
  return {
    status: 'completed',
    summary: 'Local review completed',
    completedInputIds: context.input.eventIds,
    gapIds: [],
  }
}
```

![Use credentials in your pod script](images/handbook-credentials.png)

## A small script you can adapt

A pod script is a JavaScript ES module exporting async run(context). Await every asynchronous operation before returning. The result includes status, summary, completedInputIds and gapIds. A completedWithGaps result needs committed gap claims.

context.input contains the frozen assignment/run metadata, event IDs, prior checkpoint, references and limits. context.workspace is the pod’s writable directory; context.references identifies read-only snapshots. context.log(message) records a run event. context.variables contains the frozen ordinary values captured for this run; values only enter a model prompt when the script explicitly includes them.

context.progress.commit writes checkpoint, sources and claims atomically using expectedRevision. context.agent.run({ prompt }) invokes Codex with a fresh regular-run context and the pod’s existing access boundary. context.tools.invoke and the bundled context.mail API accept only their defined read contracts and assigned scope; they are not a generic host shell.

The following example adds a checkpoint flag and returns a visible summary. It uses no mail or model service. Keep input completion IDs limited to work the script actually completed.

```javascript
export async function run(context) {
  await context.progress.commit({
    expectedRevision: context.input.checkpointRevision,
    checkpoint: { ...context.input.checkpoint, reviewed: true },
    sources: [],
    claims: [],
  })
  return {
    status: 'completed',
    summary: 'Local review completed',
    completedInputIds: context.input.eventIds,
    gapIds: [],
  }
}
```

## Schedules, events and limits

Under Settings → Schedule and limits, choose At an interval or Daily. Enter Interval in minutes, or Local time and an IANA timezone such as Europe/Vienna. Save the schedule with its explicit enabled setting. A paused pod still requires Resume automatic execution.

The application-wide concurrency limit defaults to two active pods and can be configured from one to sixteen. Each individual pod still has one active run at most. Pausing prevents new automatic starts and allows an existing run to finish; use Cancel in History to stop it.

The app watches assigned reference changes and supports persisted events internally. This version has no generic webhook or event-rule designer in the UI. New inputs are recorded and deduplicated according to the source contract.

After sleep or downtime, one catch-up processes remaining input from saved progress. Scheduling requires the app to be running and the Mac awake.

## Connections and read-only mail

Connections & setup manages three separate connections: ChatGPT for model execution, OpenApe for pod identity and permissions, and Microsoft 365 for read-only mail. Follow each provider’s login flow. Connection cards show progress and allow cancellation or disconnection.

For mail, select the OpenApe owner and Microsoft account, load folders, and choose the exact folder scope. Select an initial UTC date or All available history. Attachment access is a separate choice. Review the scope and provider data use, then confirm the native assignment dialog.

The read-only mail recipe can consider received messages, sent replies and permitted attachments. It keeps knowledge with sources and records processing progress. Content used for analysis may be sent to the connected model provider. Unsupported attachments become verification gaps.

Assigned mail reads are non-mutating: they do not send, move, label or mark messages read. Each pod has an agent identity and scoped access. Authentication refresh is handled by the trusted connection/tool boundary; secrets do not belong in scripts.

The current test build has synthetic acceptance evidence. Actual provider sign-in, tenant token refresh and live mail behavior remain release acceptance work. No live access is required to follow the local script tutorial.

![Connections and read-only mail](images/handbook-setup.png)

## Data, backups and updates

Data & backups shows application data usage, available disk space and pending local deletions. The storage limit defaults to 10 GiB and accepts 1–1,024 GiB. Usage is sampled every five seconds: execution stops at the limit or below 256 MiB free space. Temporary usage can exceed the limit between checks.

Clean unused files removes unreferenced local files while retaining knowledge, cited evidence, history and pending inputs. Backups and previously restored profiles remain separate.

Finish the master turn and stop or recover runs before maintenance. Export backup… includes settings, scripts, workspaces, knowledge, sources and history. Managed account credentials are excluded, but personal content or secrets you wrote into source or files remain part of that data.

Restore backup and restart… verifies checksums and switches to a new profile while retaining the current profile. Reconnect accounts, review resources, validate scripts and explicitly enable schedules before resuming automated use.

Verify update and back up… checks a downloaded signed app and prepares a backup. Installation is manual after quitting. Keep the previous app and a compatible backup for rollback. Never open a newer migrated database with an older app. The unsigned development DMG is not a signed update candidate.

![Data, backups and updates](images/handbook-data.png)

## Troubleshooting

Worker unavailable or Needs attention: read the displayed error. Reopen the app after resolving the cause, then inspect interrupted runs. An unsupported OS or CPU cannot be fixed by editing a script.

Validate this version for the current assignment and permissions: reopen the source, save a draft for the current assignment, validate and activate it. Revoked resources must be explicitly reassigned before use.

Syntax or contract errors: correct the JavaScript and ensure run(context) returns the required result. Await asynchronous calls and keep returned gap IDs tied to committed gaps. The active script remains unchanged after a failed check.

No automatic run: check the active script, enabled schedule, pod lifecycle, next-run time, worker status, resource state, queued recovery and whether the Mac is awake.

No mail findings: check account and folder scope, initial history, attachment access, connection readiness and run errors. Empty findings alone do not establish that all evidence was read.

Storage limit reached: export a backup if needed, remove unwanted archived pods through the confirmation flow, clean unused files or increase the configured limit. Then inspect recovery before retrying interrupted work.
