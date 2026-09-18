# OpenApe Pods · User handbook

[Deutsch](handbook.de.md)

Your pods, their scripts and the evidence they keep.

Generated from handbook.json. Screenshots use the packaged app with synthetic data.

## Start here

Choose a pod in the sidebar, then use Overview, Chat, Script, Variables and secrets, Permissions, Settings and History. Drag the sidebar divider or focus it and press Left/Right to resize; collapse it with the arrow button. Width is saved on this Mac.

This handbook covers the unsigned 0.1.0 development app. Screenshots use synthetic orders and local reference files. Actual ChatGPT/OpenApe/Microsoft sign-in, live mail and signed distribution still need release acceptance. Runtime execution currently requires Apple Silicon and Darwin 25.6.0, verified on macOS 26.6.2. An unsupported host displays an error and blocks execution.

The app bundles Electron, Node.js and Codex. You do not need a separate Node installation for packaged runs. Mount the supplied DMG and copy OpenApe Pods to Applications. An unsigned test build is subject to macOS security review; it is not a notarized release.

Closing the window keeps the app available through its menu-bar presence. Quitting stops local execution; the Mac cannot run schedules while asleep. Reopen the app to inspect interrupted work. Normal data lives in ~/Library/Application Support/OpenApe Pods.

## Choose your language

Open App settings in the sidebar and use Language to switch between Deutsch and English. Your choice is saved per local profile and applies to the interface, native menus and app-owned dialogs. Unsaved editor content is retained when navigating there.

Pod and group names, knowledge, sources, conversation messages, script code and technical audit payloads stay in their original language. The switch does not translate your content or change model prompts. Known app diagnostics are translated; an unknown external diagnostic is labeled and retained exactly. Dates and numbers follow the selected display language; stored times, schedule time zones and script contracts remain unchanged.

The handbook is available as complete English and German offline editions with matching app screenshots. Use the link to the other edition in the handbook navigation. Keep both HTML files together when using those links. The language preference is local display configuration; a restored profile starts from its system default until you choose again.

## Your first local run

Try the explicit example below in a new pod. It returns a local result without account connections. An empty script editor contains no saved implementation.

1. Choose New pod, expand Create without chat, enter Pod name, and Save pod.
2. Open Script and paste the example below into the empty editor.
3. Choose Run. The app saves and validates the source before starting the local run.
4. Inspect History and the completed result. Select a run to inspect persisted events.
5. Return to Overview for the last result. Automatic execution remains disabled.

```javascript
export async function run(context) {
  return { status: 'completed', summary: 'Local example completed', completedInputIds: context.input.eventIds, gapIds: [] };
}
```

## Organize pods in groups

Use groups in the sidebar to organize related pods. Every pod belongs to one flat group or Ungrouped. Group names, membership and collapsed state are saved on this Mac and included in backups. Groups appear in creation order; pods keep their original creation order within each group.

Grouping does not share resources or permissions, invalidate a script or alter a running task. New pods begin in Ungrouped. Removing a group keeps every pod; deleting a pod remains a separate Data & backups action.

1. Choose + Group beside YOUR PODS, enter a Group name and choose Create group. Names contain 1–100 characters; up to fifty groups are supported.
2. Select a pod, open Settings and choose Group. Dragging a pod onto a sidebar group also works.
3. Choose a group heading to collapse or expand it. The selected pod stays open in the workspace while its group is collapsed.
4. Choose the three-dot button beside a group to rename it. To remove the group, choose Remove group and confirm that its pods move to Ungrouped.
5. If another edit changed the groups, keep your entered text, wait for the sidebar to refresh and try again.

![Organize pods in groups](images/handbook-groups.png)

## Overview

Description summarizes the current agreed requirements from the pod conversation. It refreshes after completed exchanges. Later corrections supersede older wishes; the Start request remains unchanged in Chat. Use Change in chat to describe a change. Refresh description regenerates the short overview text from the existing conversation without sending a new message.

The description is informational. Its wording does not approve access, activate a script, change script execution or enable automation. Updating and Not updated indicate pending or failed generation; Retry description keeps the last successful text until a new result is available. Pods without a description show a link to Chat, where you can describe their task.

1. Open a pod and read Description.
2. Use Change in chat for a correction. The Start request remains available in Chat.
3. Inspect the last run and use Run now when the script is ready.

![Overview](images/handbook-overview.png)

## Chat and pod creation

Every pod has a Chat tab with its own persisted history and Codex continuation thread. Ask the assistant to prepare the script and required access. New pod starts the creation chat; Create without chat exposes the local form.

The assistant can prepare, validate and activate scripts within existing permissions. Additional access and secret approval remain owner decisions. It cannot enable schedules. Only one assistant turn runs across the app at a time; cancel or finish it before starting another pod conversation.

Write a message in the input at the bottom. Enter sends it; Shift + Enter adds a new line. The stop button interrupts the response. Sending while a response is running adds your instruction to that conversation. Unsent text is retained when you change tabs. The regular script agent uses fresh context and does not automatically receive this chat, variable values or secrets.

App settings → Workspace chat retains the previous global conversation and supports workspace-wide creation. Pod chats provide separate histories and model threads, while using the existing owner-authorized master control capabilities.

The chat can set ordinary variables, assign or create a group, and prepare an interval or daily schedule. Schedule preparation leaves automation disabled and pauses automatic execution. Enable it yourself in Settings after reviewing the script and access. A selected pod chat cannot read or change another pod; the workspace creation chat can create pods.

The assistant reads the app runtime reference before writing scripts. It can validate and repair a saved draft within existing permissions. Application, HTTPS and directory proposals open prefilled review forms directly in chat. Native confirmation remains required; a proposal itself grants no access. Legacy proposals may need missing fields. Named-secret proposals open Variables and secrets with the alias selected.

Ordinary variable values are visible to the assistant when it inspects the pod. Tokens, passwords and API keys belong in Secrets. A secret proposal contains only its name and purpose. Assign secret values in Variables and secrets. A validated script can use its declared, assigned secrets; changing the script does not remove those assignments. The chat cannot retrieve stored secret values.

Example prompt: “Create a mail notification pod for phofmann@delta-mind.at. Check for new messages through the assigned o365-cli application every 15 minutes and notify my Telegram chat. Use a quiet first-run baseline and avoid duplicates. Store the Telegram chat ID as an ordinary variable and request bot_token as a secret. Request the application read commands and Telegram HTTPS permission. Prepare the script and interval, but leave automation disabled and do not run it yet.” Supply the missing chat ID, configure o365-cli through its terminal in Permissions and store the token in Variables and secrets.

Synthetic validation exercises one initial path with an empty checkpoint, no reference snapshots and simulated services. It does not prove real authentication, provider response formats, later branches or actual delivery. The automated one-prompt test uses the real packaged chat and Codex process with a recorded model. Actual model generation quality and live integrations require separate acceptance.

The assistant can inspect the current saved script, including a newer saved draft from the editor. Save your manual edits before asking the chat to revise them; unsaved editor text is not available to the assistant.

Your messages appear on the right and assistant replies on the left. The original creation request appears once as an ordinary message in the saved conversation. Technical requests, results and script drafts are collapsed under Technical details. Access proposals remain available for your review. The app opens the created pod automatically and preserves its conversation across restarts. Older unlinked creation history can be recovered after reviewing the proposed requests.

Choose Chat model before sending, including GPT-6 Astra. The app remembers your selection on this Mac and uses it for creation and subsequent chat turns. Changing this selection does not change models specified in scheduled scripts.

Answer question saves missing ordinary configuration. Never enter secrets there or in a chat message. Secret proposals explain how to obtain the value and link to its protected input form. After supplying values and approving access, use Continue setup. This asks the assistant to inspect saved progress and finish the script, leaving schedules unchanged and without starting a run.

An interrupted response may have announced work that was never saved. Chat reports whether a script is missing, a draft is saved or an active script exists. The empty editor no longer displays an automatic example. Continue setup resumes from the saved state.

![Chat and pod creation](images/handbook-chat.png)

## Inspect and edit your script

The Script tab opens the current saved working source, including a newer saved draft. V1 has no version browser, comparison or rollback controls. Internal immutable script hashes, validation, credential approval and run pinning remain enforced.

The highlighted JavaScript editor supports line numbers, horizontal scrolling, two-space Tab indentation, Escape followed by Tab to leave, and Cmd+S (Ctrl+S) to save. Source is rendered literally and is not executed in the renderer.

Unsaved script, ordinary variable, settings and chat text survive navigation within this app session. Save before quitting. Reload script asks before discarding changed text. If a concurrent change causes a conflict, reload the current source or explicitly save your edits as the current script.

Available variables and secrets expands a reference list with copyable access expressions. Secret values stay hidden. Manage variables and secrets opens their dedicated tab. Manage script secrets in Variables and secrets, and script applications in Permissions. Selecting a capability does not grant resource access.

Saved runs start through the bundled ape-shell as the pod agent. The Node.js run(context) contract remains unchanged; HOME, working directory and SHELL match the setup terminal. Missing grants block execution. context.tools.invoke reuses application setup; secrets do not automatically enter the AI context.

Under Dependencies, the list shows each package and its fixed version. Click + to search the public npm registry, paste an npm package-page URL, or enter name@1.2.3. Select a result, review the exact version and add it; selecting an existing name updates its declaration. Select a row and click − to remove it. These edits are saved with the script. Prepare dependencies downloads the selected packages after confirmation. Searching and adding do not install anything. Git, tarball and private-registry URLs are not supported. Libraries share the script’s permissions and secret access. Preparation excludes installation hooks and native addons; regular runs use the verified read-only package tree without downloads or updates. Package changes require validation and renewed secret approval. The saved package.json remains available to the pod chat.

1. Edit the source and choose Save script to persist it without running.
2. Choose Run or Save and run. The app saves and validates changed source in the existing sandbox with synthetic services. A failed check preserves the source and leaves the previously active script intact.
3. If secret access is required, review the full source and choose Review credential access. The native confirmation names the pod, exact SHA-256 and requested aliases. Cancelling keeps execution blocked.
4. After successful validation and any required owner approval, the app activates that exact source and starts it. History shows the result. This does not enable automatic execution.

![Inspect and edit your script](images/handbook-script.png)

## Variables and secrets

Ordinary variables are named strings stored in SQLite for this pod. Use context.variables["name"] in scripts. Up to 32 variables are supported, with values up to 2,048 characters. Values are captured for each run; later edits apply to future runs. These values are not encrypted. Store sensitive values as secrets.

The dedicated tab shows all stored variables and secrets for this pod. Empty variables are marked Not set. Secrets required by the saved script or requested in pending chat proposals also appear before a value has been assigned; choose Set secret to prefill the alias. Assigning a secret authorizes this Pod to read that alias from its validated scripts; removing the assignment revokes access.

Each pod owns its script versions, workspace, persistent checkpoint and credential assignments. Under Variables and secrets, enter a Credential alias and a masked Credential value, then choose Save or replace credential. An alias starts with a lowercase letter and contains at most 64 lowercase letters, digits, underscores or hyphens. Values contain 1–16,384 characters without null bytes. Each pod supports 32 current aliases; a script can declare up to 16 capabilities including assigned application and HTTP capabilities.

Values are encrypted with macOS safeStorage under the active application profile’s credentials directory. Resource records and editor history contain aliases and opaque IDs, never the automatically supplied value. Two pods may use the same alias with different values. ChatGPT and OpenApe tokens stay inside their connection broker. Imported application state is delivered only to its program, separately from script secrets.

await context.credentials.get('crm') returns the string assigned to this pod and alias. Declare credential.crm under Secrets used by the script in Variables and secrets, then save script access. The runtime verifies the current run lease, exact script version, execution binding, resource revision and current secret assignment before and after reading. Codex has no credentials.get tool. Values are not automatically added to input.json, environment, AI prompts or run logs.

A script that can read a secret can explicitly put it into a prompt, log, checkpoint or file. Review the full source before granting access. Synthetic validation checks the execution contract with synthetic-credential-<alias> values; it cannot establish that source is safe for every input. A later model call receives whatever prompt the script constructs. Files written by the script and their contents may be included in backups.

Saving or replacing a credential pauses the pod and invalidates prior validation. Script source changes alone do not require another secret approval. Revoking it cancels affected work and removes its encrypted value. After restore, assign secret values again and revalidate scripts; managed secret values and their recovery records are excluded from backups. An interrupted save is reconciled on restart. New versions prepared by the master cannot grant themselves credential access.

The example below combines normal Node file IO, durable variables, an explicit credential read and a separate AI call. It deliberately keeps the credential out of the prompt. It requires an assigned crm alias, Pod execution permission and a connected model for real execution. Validation uses a synthetic model response. Direct network access and launching child programs remain restricted by the existing runtime; declaring a credential does not grant either.

1. Open Variables and secrets. Enter the secret alias and value, then save. The masked field clears after submission, including failures.
2. In Variables and secrets, select the aliases under Secrets used by the script and save script access. Save unfinished code edits in Script first. Use await context.credentials.get("alias") in the source.
3. Choose Save and run. After synthetic validation, review the Pod execution permission in the browser if requested.
4. History shows the run. Source or resource changes require validation; existing Pod permissions remain until revoked.

```javascript
import { readFile, writeFile } from 'node:fs/promises'

export async function run(context) {
  const credential = await context.credentials.get('crm')
  if (!credential) throw new Error('Assigned credential is empty')

  const notes = context.input.checkpoint.notes ?? 'Review synthetic notes'
  await writeFile(context.workspace + '/notes.txt', notes)
  const text = await readFile(context.workspace + '/notes.txt', 'utf8')
  const answer = await context.agent.run({ prompt: text, tools: [] })
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

![Variables and secrets](images/handbook-credentials.png)

## Concurrent edits and recovery

If a chat or another edit changes the saved script while your editor contains unsaved work, the app retains your text and rejects a stale save. Reload script lets you discard your local edits after confirmation. Save my changes as current script explicitly preserves your text as a new working artifact; it still requires validation and any credential approval before running.

Reloading an unchanged editor picks up the current saved source. Saving does not start a run. A Run request rejects a changed active script, an occupied execution slot or pending inputs rather than silently executing different code later.

## Permissions

Permissions lists HOME and the working directory as permanent writable pod folders. Add additional folders with +, choose Read or Read and write in the native confirmation, and change access with the row selector. Select a row and − to revoke it. These are direct accesses to the original files, including subfolders; write access allows changes and deletion. Existing reference files retain their read-only snapshots. Assignment or access changes pause the pod and invalidate active execution. Missing, replaced or symlinked folders block execution until reassigned; internal app data and runtime folders cannot be assigned.

The macOS sandbox enforces directory read/write permissions for regular scripts and brokered application calls. External setup terminals and Play-launched GUI apps keep the existing Mac-user/ape-shell permission boundary; the directory list does not sandbox those windows. Overlapping folder permissions are additive: an explicitly writable child remains writable inside a read-only parent.

Use + below the application list to select an installed macOS app or CLI. Its name and icon appear with a Play button. Play starts the selected executable without arguments through ape-shell. Select a row and use − to remove its assignment. Existing apes CLI descriptors are detected automatically, or you can select the descriptor file. Applications are not bundled with Pods.

Open Terminal.app opens a separate macOS window above this list. The banner shows the pod HOME, workspace and shell. Run an assigned CLI there using its normal commands, for example o365-cli auth login. Applications manage their own sign-in; Pods does not invent a login-status indicator. Required grants are approved through OpenApe or apes grants approve.

Grants are managed through OpenApe and checked at execution time. Permissions does not display a static command-grant list, script call snippets or a separate application script-access selector. Application assignment does not bypass runtime authorization.

HTTP destinations appear as a list of addresses and allowed methods. Use + to add a destination; select a row and use − to remove it. The input form opens only when adding a destination. These permissions allow Node.js requests to an explicit HTTPS origin and selected methods through context.http.request. Secrets belong in Variables and secrets. Requests cannot follow redirects or reach private addresses. Current transport uses IPv4 on port 443, a 30-second timeout and bounded responses. Permissions are granted to the pod’s OpenApe agent.

An open terminal holds the pod and pauses automation, including while its prompt is idle. Leave the shell with exit and wait for the process to finish so application setup is saved. Automation remains paused afterwards. Assigned programs receive their own temporary HOME containing decrypted application state; later script calls reuse that saved state. The shell HOME is pods/<pod-id>/home and its working directory is pods/<pod-id>/workspace inside the app profile. Interrupted sessions are not treated as successful setup.

ape-shell mediates command grants; it does not provide a filesystem sandbox. The setup terminal runs granted commands with your Mac user privileges. A broad session grant permits correspondingly broad shell commands. Use foreground programs; reliable termination of detached background processes is not guaranteed. Automated Node.js scripts retain their additional macOS sandbox, and context.tools.invoke still uses the bounded application broker. Graphical programs and arbitrary child-process trees remain unsupported in that script broker.

Play starts apps directly with the pod workspace and private application HOME, using the normal login Keychain. Some Mac apps ignore HOME or reuse a global profile or existing instance: check the account inside the app. Only programs respecting the supplied context can share setup reliably. Close the app normally to save setup. Interrupted sessions keep the last saved setup. Encrypted state is currently limited to 4 MB and 128 files; large browser profiles are not supported by this storage contract.

Select an application to add or remove its HTTPS hostnames. Sandboxed application calls can connect only to these public hosts on port 443; command grants still apply. This is separate from Node.js HTTP destinations. Changing hosts pauses the pod and invalidates prior script validation. Setup terminals and GUI windows retain their existing Mac-user permissions.

![Permissions](images/handbook-permissions.png)

## Settings

Settings contains the pod name, group, automation and interval, and More options. The generated description is updated through Chat. The script controls each run and supplies the prompts for its AI calls. There is no separate execution-assignment field. Renaming a pod preserves running work, script validation, credential approval and automation state.

Expand More options to archive the pod or delete an archived pod through a separate native confirmation. Deletion removes its variables and pod chat as well as local data. Workspace chat, shared accounts and original reference files remain.

![Settings](images/handbook-settings.png)

## History and recovery

History shows the result, the next action and What happened. Repeated application calls and AI requests are grouped with successful and unfinished counts. Routine permission checks stay in collapsed Technical details, together with the pinned script and persisted events.

Cancel run stops an active run. Interrupted work remains visible after a crash or restart. Choose Prepare retry to check saved progress and possible deliveries without starting the script. Retry unfinished work becomes available after a successful check. Resolve uncertain deliveries first. Overview also leads to this check after a stopped run.

At most one run executes per pod. Other waiting starts counts queued start requests, not emails or files. Repeated start clicks may create several requests. Retry unstarted requests applies to a blocked queue. Checkpoints record successful progress; resuming a Codex thread alone is not a recovery decision.

Changing the script only affects subsequent runs and does not undo earlier results or effects. Internal script hashes remain in execution details for auditability.

Unknown HTTP deliveries appear in History. Record what you observed at the destination and choose Already delivered or Not delivered · allow retry. The former records an owner-attested receipt, not a provider response; the latter permits a subsequent retry. A lost response is never automatically resent.

![History and recovery](images/handbook-history.png)

## Results and sources

Knowledge contains durable statements with supporting evidence. Findings describe supported business facts. Open questions need a business answer. Verification gaps identify missing or unreadable evidence; a gap is not automatically an unanswered business question.

Filter by kind, and enable Include superseded history to inspect earlier statements. Current statements can replace earlier ones while retaining their source history. Additional entries are paginated.

Expand an entry and choose its source to view the retained content, version and digest. Extracted text can link to its retained original. Long source previews are explicitly marked as truncated. Source text is displayed literally.

Use the contextual discussion action to ask the master about the selected pod. Statements and source history stay in the pod independently of the chat.

![Results and sources](images/handbook-knowledge.png)

## A small script you can adapt

A pod script is a JavaScript ES module exporting async run(context). Await every asynchronous operation before returning. The result includes status, summary, completedInputIds and gapIds. A completedWithGaps result needs committed gap claims.

context.input contains the frozen run metadata, event IDs, prior checkpoint, references and limits. context.home and context.workspace are the permanent writable pod directories. context.directories lists assigned original folders as {path, access}, with access read or readWrite; use Node.js filesystem APIs on those paths. context.references identifies read-only snapshots. context.log(message) records a run event. context.variables contains the frozen ordinary values captured for this run; values only enter a model prompt when the script explicitly includes them.

context.progress.commit writes checkpoint, sources and claims atomically using expectedRevision. context.agent.run({ prompt, tools: [] }) invokes Codex with fresh context and no tools. Omitting tools also disables them. Use tools: ["ape_shell"] explicitly when the model needs assigned application reads; assignments and grants still apply. The script may continue using context.tools.invoke independently. context.tools.invoke({ application: "o365-cli", argv }) executes an assigned read command through apes. context.http.request({ url, method, headers, body, key }) uses an assigned HTTP destination; every mutating method requires a stable effect key. Only calls opting into ape_shell receive that tool; neither mode exposes a credential or HTTP tool. Treat model output as untrusted text, never executable code. Legacy context.mail scripts need migration to an assigned installed application; source and history remain available.

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

## Execution approvals and run activity

Starting a manual run opens any required OpenApe approval in your browser. A waiting card also appears in the Pod workspace with Open approval, so a browser-opening failure does not hide the required action. Background runs show the card without opening the browser automatically. Approval waits last at most 15 minutes and pause the script's active time limit. Cancel run stops waiting. After an application restart, a stopped run requires explicit recovery; approving its old request does not restart it.

The managed execution permission belongs to this Pod and its OpenApe agent. Allow Pod execution creates a revocable standing rule; Once authorizes only the current request. Script edits do not expand directory, application, HTTP or secret assignments. The desktop broker verifies the structured permission through the ape-shell authorization library, then launches the pinned script inside the existing native sandbox. External Terminal.app continues to use the ape-shell CLI.

History shows actual operations, active elapsed time, approval wait time and the run outcome. Application, AI and HTTP steps appear only when called. Technical details contains the original error and event data. If authorization fails, review Permissions and the grant status; a permission-service error does not itself require signing into Microsoft again. For uncertain deliveries, inspect the destination and record the outcome before retrying. The Script tab's Environment disclosure shows the managed process environment without stored secret values.

## Schedules, events and limits

Under Settings → Schedule and limits, choose At an interval or Daily. Enter Interval in minutes, or Local time and an IANA timezone such as Europe/Vienna. Save the schedule with its explicit enabled setting. A paused pod still requires Resume automatic execution.

The application-wide concurrency limit defaults to two active pods and can be configured from one to sixteen. Each individual pod still has one active run at most. Pausing prevents new automatic starts and allows an existing run to finish; use Cancel in History to stop it.

The app watches assigned reference changes and supports persisted events internally. This version has no generic webhook or event-rule designer in the UI. New inputs are recorded and deduplicated according to the source contract.

After sleep or downtime, one catch-up processes remaining input from saved progress. Scheduling requires the app to be running and the Mac awake.

## Connections and the mail notification recipe

Connections & setup has two global connections: ChatGPT/Codex for AI execution and OpenApe for pod identities and grants. Other programs authenticate in Permissions, using the pod’s external Terminal.app window or the application opened with Play.

For a mail notification pod, select your installed o365-cli in Permissions and configure it through Terminal.app using its own auth commands. Inspect its help and approved apes descriptor before writing the script. Installed versions can differ from the former prototype protocol; do not use o365-cli pods commands unless your selected installation actually supports them.

Store telegram_chat_id as a variable and telegram_bot_token as a secret. The selected CLI determines whether the script needs an explicit mailbox variable. Allow POST to https://api.telegram.org in Permissions. Telegram needs no separate account card or bundled executable.

Use examples/mail-notification.mjs from the source checkout. The first successful run establishes a quiet baseline over the previous 24 hours. Later runs report new message identities using a five-minute overlap. The recipe caps reads at 20 pages and 1000 messages per window and fails visibly if the window is incomplete. It never sends historical messages on first use and sends only a count and account name.

Validate and run manually before enabling a 15-minute interval in Settings. Review the secrets assigned to this Pod. The recipe records a pending notification before sending it and stores the receipt before acknowledging progress. When delivery is uncertain, inspect the destination and resolve the outcome in History before retrying.

![Connections and the mail notification recipe](images/handbook-setup.png)

## Data, backups and updates

Data & backups shows application data usage, available disk space and pending local deletions. The storage limit defaults to 10 GiB and accepts 1–1,024 GiB. Usage is sampled every five seconds: execution stops at the limit or below 256 MiB free space. Temporary usage can exceed the limit between checks.

Clean unused files removes unreferenced local files while retaining knowledge, cited evidence, history and pending inputs. Backups and previously restored profiles remain separate.

Finish the master turn and stop or recover runs before maintenance. Export backup… includes settings, scripts, workspaces, knowledge, sources and history. Managed account credentials are excluded, but personal content or secrets you wrote into source or files remain part of that data.The shell HOME, its command history and protected application state are excluded from exported backups; keep durable work files in the workspace.

Restore backup and restart… verifies checksums and switches to a new profile while retaining the current profile. Reconnect accounts, review resources, validate scripts and explicitly enable schedules before resuming automated use.

Verify update and back up… checks a downloaded signed app and prepares a backup. Installation is manual after quitting. Keep the previous app and a compatible backup for rollback. Never open a newer migrated database with an older app. The unsigned development DMG is not a signed update candidate.

![Data, backups and updates](images/handbook-data.png)

## Troubleshooting

Worker unavailable or Needs attention: read the displayed error. Reopen the app after resolving the cause, then inspect interrupted runs. An unsupported OS or CPU cannot be fixed by editing a script.

Validate this version for the current script and permissions: reopen the source, save a draft, validate and activate it. Revoked resources must be explicitly reassigned before use.

Syntax or contract errors: correct the JavaScript and ensure run(context) returns the required result. Await asynchronous calls and keep returned gap IDs tied to committed gaps. The active script remains unchanged after a failed check.

No automatic run: check the active script, enabled schedule, pod lifecycle, next-run time, worker status, resource state, queued recovery and whether the Mac is awake.

Application read fails: inspect its current grant in OpenApe and its output in History. Configure the application through the pod terminal or Play. An empty result is not proof that all sources were read.

Storage limit reached: export a backup if needed, remove unwanted archived pods through the confirmation flow, clean unused files or increase the configured limit. Then inspect recovery before retrying interrupted work.
