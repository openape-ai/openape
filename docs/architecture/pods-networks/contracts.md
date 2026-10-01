# Pods persistent networks: frozen M0 contract

Status: implementation contract approved through the October 1 plan; runtime
implementation and acceptance are pending. This M0 increment changes documentation
only. [Development issue 1417](https://repos.openape.ai/patrick/monorepo/issues/1417)
tracks delivery. [Approved plan](https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M3VDB1S72E4EQQW58T97C617).

Baseline: canonical `a99c69bd2b97d8883ce5538894c3f38510407ddf`, Pods 0.1.1,
Pods protocol 0.1.0, database schema 27. The isolated M0 checkout is
`openape-monorepo.worktrees/pods-workflows-networks`, branch
`feature/issue-1417-pods-networks-m0`. These are baseline facts, not release evidence.

## Domain and representation

Keep `workflows` and its `mode: sequence | channels` representation unchanged.
Both are finite legacy compositions. The presentation adapter returns
`kind: workflow`, `semantics: legacy-sequence-v1 | legacy-channels-v1` with the
original ID/revision. A bounded channel graph is visibly labelled **Bounded graph**.
Do not feed it to NetworkEngine or activate it as a side effect of migration.

New composition contracts have `formatVersion: 1`, `kind: workflow | network`
and immutable positive revisions. New networks use separate `networks` and
`network_revisions` tables, `semantics: persistent-network-v1`. New workflow
ports/revisions extend the finite engine; they do not require converting legacy
workflow records. Historical traces and original IDs remain unchanged. Conversion
creates a new network UUID and retains `ancestorWorkflowId` plus source revision.

An immutable Pod definition version contains code/content hash, dependency lock
hash, declared input/output schemas, collection/artifact operations, workflow call
ports, required configuration and requested capabilities. It has no credentials,
execution identity, grants or mutable home. A definition owns version IDs; an
instance pins one version through `instance_definition_bindings`. Existing Pod
UUIDs, homes, remote identities, scripts and script history remain instance-owned.
A local, unpublished definition is created for each existing instance in M8.

A Pod invocation uses the existing run UUID and a pinned manifest containing
execution domain (`standalone | workflow | network`), composition ID/revision,
definition version, binding revision, resource epoch, trigger, input IDs and hash,
configuration provenance, runtime boot authority and claim epoch. Its manifest is
immutable. A case UUID identifies a business subject, not a run, delivery or lease.
`caseRevision` is an opaque stable source/correlation revision string. Event UUIDs
identify individual accepted facts. Source item/version identifies provider input.

One mutable instance has at most one persistent home network and one active
invocation by default. Network/group/instance owner and company must match.
Existing workflow reservations continue to arbitrate workflow instance access.
A network calls a finite workflow via declared ports; it cannot reserve that
workflow's instances itself. Group movement with live bindings requires review.

## Activation and dispatch

Networks are created `paused`. State is `active | paused | archived`; no network
completion state exists. Activation validates pinned contracts, schemas, company
membership, required configuration, resources and per-instance rights before
enabling only declared triggers. Activation grants no new external capability.

Each source schedule fires independently using the existing timezone-aware clock.
Consumers start on any ready subscribed input, without waiting for producers.
Consumer schedules define batching windows. An explicit join is the only barrier.
No empty input launches a script, Jev call or model call. Gate maintenance is a
separate bounded runtime task with the downstream Pod's identity.

Pause disables automatic intake and new dispatch; active invocations can settle.
A paused member receives no automatic network dispatch, even if its network is
active. Manual Process now previews selected sources and ready consumers, uses a
bounded budget, and can process a paused network without enabling its schedules.
Invoking a paused member explicitly requires review. Legacy workflow manual-start
semantics remain unchanged and are explained in conversion preview.

Resume shows pending count, oldest age and catch-up baseline. It does not replay
historical effects. Stop cancels the real process and fences later callbacks;
possibly issued external effects become `unknown`. Archive requires all active
invocations settled and explicit pending-work handling. Never drop unresolved work.
Closing the app stops execution: the browser shows runtime offline and retained
work. There is no background service or competing relay execution authority.

Fair rotation covers standalone Pods, finite workflows and networks under the
existing global concurrency limit (1–8). Initial per-network limit is at most the
global limit; M1 records scheduler measurements before selecting a lower default.
Instance leases remain exclusive. Priority cannot bypass fair domain rotation.
Optional serial-per-case subscriptions cannot overlap invocations for that case.

## Schemas and event acceptance

Use a small local schema language; no dependency is needed for the initial subset.
`PayloadSchema` is an object with named properties, a required-property list and
`additionalProperties: false`. Fields are string, finite number, integer, boolean,
null or bounded arrays of those scalars. Scalar enums and string/array maximum
lengths are supported. No recursive objects, regex expressions, executable
validators, remote references or automatic coercion. Limit 32 fields and 32 array
entries, depth two; serialized metadata remains at most 1,024 UTF-8 bytes.
Complex business data belongs in a scoped collection/artifact reference.
Reject unknown schema keywords instead of silently ignoring them.

A channel pins `{name, title, schemaVersion, schema}`. A positive schema version
is immutable; changes create a new version and an explicit compatibility review.
Channel names retain the current technical naming rule. Jev/model outputs are
untrusted: validate both the metadata schema and allowed output channel.

Accepted envelope:

```ts
interface NetworkEvent {
  eventId: string
  networkId: string
  channel: string
  schemaVersion: number
  caseId: string
  caseRevision: string
  sourceId: string
  sourceItemId: string
  sourceVersion: string
  causationId: string | null
  definitionRevision: number
  occurredAt: number
  acceptedAt: number
  payload: Record<string, unknown>
  feedbackHop: number
}
```

Runtime generates UUID, acceptance time and feedback hop. It verifies pinned
producer/channel rights and source identity. The runtime deduplication tuple is
`[owner, networkId, sourceId, sourceItemId, sourceVersion, channel, schemaVersion]`;
canonical serialization is hashed by the runtime. Including channel supports one
source record emitting distinct facts. Same tuple and payload hash returns the
original receipt; conflicting content is an explicit conflict, never replacement.
An LLM does not choose the deduplication or effect key.

Acceptance atomically persists event, marker and one delivery per subscriber.
`UNIQUE(event_id, subscription_id)` enforces fan-out; consumer A acknowledging
never removes B's delivery. Source cursor advancement occurs only with the durable
acceptance receipt/checkpoint commit. A crash before checkpoint advancement can
repeat acceptance safely. Oldest accepted event first within each subscription;
concurrent branches have no global order guarantee. Invalid producer input is
rejected before acceptance; incompatible already accepted deliveries enter review.

## Delivery authority, settlement and replay

States: `pending -> claimed -> done`, plus `retry_wait`, `blocked`, `unknown`,
`discarded`. Claim records include delivery ID, subscriber, claimant run UUID,
pinned revisions, random lease token, expiry, attempt number and authority epoch.
Every settlement/retry transition compares token, claimant, epoch and current
binding authority in a short database transaction. Lease expiry does not prove
process termination. Stop or prove termination before reassignment, then advance
the epoch. A timed-out async callback cannot commit with its former epoch.
Existing `boundedStep` uses Promise.race without cancellation: retain it for legacy
call sites, but do not treat it as authority fencing for new network operations.

Successful settlement atomically acknowledges inputs, applies staged collection
writes and tombstones, records revisions/provenance, accepts buffered emits and
creates deliveries/change events. Check all permissions and expected revisions
before changing anything. A rejected or failed settlement publishes none of those
outputs. Reads see invocation-local staged writes. No external await occurs while
holding SQLite's write transaction. Database remains local WAL, synchronous FULL,
foreign keys ON; never put the file on a shared network filesystem.

External actions remain outside that transaction. EffectLedger keeps stable
logical action keys and its existing input digest; ordinary retry reuses them.
Confirmed effects return their receipt without resending. Intent/unknown outcomes
block automatic retry until explicit reconciliation. A new feedback hop cannot
change the key for the same intended effect. A locally transactional conflict can
retry only after the classifier establishes that no external effect is uncertain.

Transient infrastructure failures get at most three total attempts with jittered
bounded backoff. Permission/invalid-data failures are blocked for review; exhausted
transient attempts are visible. Retry time and attempt count are durable. Replay
creates an explicit attempt identity, links its original event and states whether
effects are permitted; replay does not delete markers or confirmed effect evidence.

Keep source markers at least 90 days and longer than provider replay horizon;
otherwise require a durable reviewed watermark. Event pruning cannot remove a
marker. Keep unresolved deliveries, gate manifests and uncertain effect evidence.
Completed trace retention is seven days or 10,000 events per network within its
byte budget; compact aggregate history is 90 days. Quotas pause/refuse intake before
source checkpoint advancement and show the reason; never evict unresolved work.
M1 measures numeric byte/queue budgets before runtime activation is implemented.

## Shared data and artifacts

Collection identity is `[owner, companyGroupId, collectionId]`. Bindings explicitly
name network, Pod instance, collection schema/version and `read | write | delete`
operations. Cross-network sharing requires explicit same-company bindings;
cross-company access is refused. Configuration is separate from business records.
Precedence: Pod override, composition value, definition default. Show effective
value/origin; existing legacy name conflicts continue to fail until reviewed.

```ts
const record = await context.data.get({ collection: 'invoices', key: item.key })
await context.data.put({
  collection: 'invoices', key: item.key,
  expectedRevision: record?.revision ?? 0,
  value: { status: 'reviewed', sourceEventId: item.eventId }
})
```

`get` returns `{key, revision, value, provenance}` or null. `put` and `delete` stage
changes; expectedRevision zero is create-only. A stale revision rejects the whole
settlement, identifying collection/key/current revision. `query` uses a declared
index and scalar comparison/equality, stable key cursor and limit 1–100; no SQL,
expressions, unrestricted scans or implicit indexes. A second staged write uses
its own staged revision. Delete retains a tombstone and provenance. Provenance
records Pod, definition version, invocation, source references, time and revision.
Proposed findings and owner-verified records have distinct status; scripts cannot
set owner verification. No credential material is accepted as shared configuration,
collection content, event payload or reusable export.

`context.artifacts.create` stages immutable bytes under owning scope, with hash,
size, media type and artifact UUID. `read` accepts a scoped artifact reference;
it never returns an ambient host path. References track business, delivery and
gate usage. Retention deletes bytes only after all live references expire.
Quota and backup coverage include retained bytes. Existing Pod checkpoints and
snapshot APIs retain their private semantics.

## Workflows, joins and human gates

Workflow call contract declares input/output port schema versions, permitted
caller networks, required terminal branches and required owner gates. Request
contains request UUID, case ID/revision, caller network revision and pinned
workflow revision. Accept and persist the call receipt before dispatch. Repeated
request/hash attaches to one execution; conflicting hash is refused. A terminal
execution publishes one correlated success/failure/cancelled result via a unique
request result mapping. The caller holds no Pod lease while waiting. Paused caller
networks retain results. Cancellation follows recorded parent/call relationships,
stops actual processes and retains uncertain effects.

Completion waits for required terminal branches and unresolved required gates;
owner waiting is nonterminal. Missing optional branches are explicitly skipped.
Retries preserve successful steps and immutable outputs. Named ports adapt UUID
predecessor handoff through stored mappings; never rewrite arbitrary script strings.

Initial joins require one input from each declared channel/schema for exactly
`[caseId, caseRevision]`. Declaration names join ID, required channels, deadline
and review destination. Unique `[joinId, caseId, caseRevision, channel]` accepts
one input; identical redelivery is idempotent, conflicting second input goes to
review. Once complete, claim all inputs atomically. Deadline persists an incomplete
outcome and missing-channel list. Late input goes to review or an explicitly new
case revision; it cannot reopen the timed-out join. Unrelated cases continue.

Gate tasks are non-script maintenance under the downstream Pod identity. Keep
states preparing, pending, consuming, approved, denied, expired, excluded,
superseded and unknown distinguishable. Freeze item IDs/hashes, consumer identity,
definition/binding/resource revisions and manifest digest before requesting a
grant. Exclusion supersedes the batch and requests fresh approval. Changed payload
or authority invalidates release; old evidence is viewable but cannot authorize
new work. Persist consuming before one-time grant consumption. An interruption
between consumption and local settlement becomes unknown, never another consume.
Owner decisions remain owner-only; scripts/model MCP tools cannot make them.

## Definitions, migration, sharing and feedback

New definition versions are immutable; instance updates preview code, contracts,
locks, values and requested-rights differences. New rights need explicit owner
approval. Held work stays pinned to its old version or visibly blocks if authority
is no longer valid. Never automatically upgrade all instances. Provisioning retries
reuse the existing pending identity/provisioning record and do not copy grants.

M11 conversion is a dry-run preview until the owner approves the concrete cutover.
Block active runs, unresolved gates, uncertain effects, unknown provider baselines,
membership conflicts and unsupported payloads. Create paused with ancestry, preserve
original instance identities and perform source schedule ownership transfer
atomically. No simultaneous old/new intake. Old pending deliveries stay in legacy
storage until reviewed baseline/import; no inferred cursors or historical replay.

Sharing is currently absent (`sharingAvailable = false`). M11 adds the file
export/import slice under the approved sharing format/lifecycle, not a second
sharing system. Export definition versions, schemas, schedules, joins, call ports,
feedback and collection declarations; omit business records, cursors, grants,
credentials and paths. Imports map company/resources, use fresh identities and
stay paused. Locks remain validated transitively. Unsupported old importers refuse
persistent-network packages explicitly. Invitation delivery retains its own plan.

Ordinary edges remain acyclic. M12 adds an explicit feedback transition, minimum
one-second delay, maximum three hops and 24-hour case age. Runtime controls hop
and causation; bound exhaustion creates review work. Unique transition/event
identity prevents double scheduling. Pause stops dispatch; external effect keys
remain stable. There is no unrestricted LLM-controlled loop.

## Diagnostic changes and UI review

Current GraphOverview/Panel/Inspector, WorkspaceFrame and shared desktop/browser
components remain the basis. Keep All, Networks and Workflows filters, separate
Structure and Activity, and avoid a network Last run/completed label. Legacy bounded
graphs retain their label. New operational states are inactive, waiting for work,
processing, waiting for owner, degraded and offline. Show backlog/oldest age,
last intake/next trigger, decisions, quota/retry cause and processing coverage.
Creation asks finite result or continuing work, company, shared values, per-instance
resources/rights; validate and create paused. Focus restoration, keyboard navigation,
narrow layouts and counted DE/EN messages use current i18n/components. The plan's
static sketches express hierarchy, not proof of implemented UI.

All former graph diagnostics remain unchanged for legacy graphs:

| Code | Persistent-network rule |
| --- | --- |
| channel-without-producer | Require declared producer or explicit workflow-result/input port; no implicit external input. |
| channel-without-consumer | Require subscriber, explicit terminal/review sink or workflow output port. |
| channel-undeclared | Retain, including channel/schema version. |
| emit-undeclared | Retain and validate payload schema. |
| cycle | Retain for immediate edges; only declared bounded feedback is separate. |
| archive-without-gate | Retain existing concrete action authority; activation is no archive grant. |
| summary-invalid | Retain current 40-character summary rule. |
| contract-missing | Require validated immutable definition contract. |
| member-elsewhere | Enforce one home network, owner/company match and existing reservation arbitration. |
| value-name-conflict | Legacy refusal unchanged; new versions resolve explicit precedence/origin. |
| gate-consumer | Retain one downstream requester/executor per approval gate. |

New diagnostics cover unsupported semantics/schema, join cardinality/deadline,
missing call ports, source identity/watermark, binding scope, stale revision,
quota/backpressure, feedback bounds and unsupported client version. Each names
the affected member/channel/case and a concrete recovery action.

## Backup, relay and delivery boundaries

Authoritative data and recoverable backups include every new table plus artifact
bytes. UI publication is a separate bounded overview and stable-key detail cursor;
never append full network/business tables to `centralTables`. Runtime-mediated
owner-authenticated details fail clearly while offline. M10 negotiates compatible
versions before new writers ship; relay cannot claim deliveries or settle records.
Deploy the compatible relay first, then the signed desktop candidate. Restore
pauses networks/triggers, revokes claim authority, marks possibly issued actions
unknown and preserves markers/receipts. Do not overwrite later owner data or rotating
registration with an old profile. Keep owner credential/keychain recovery separate
from the current portable backup, which deliberately excludes credential files.

M13 requires clean merged canonical source, exact-head unit CI, manual real desktop
and browser routes, inspected screenshots, signed/notarized candidate, mounted DMG
and owner-state fingerprint comparison. M14 follows explicit low-risk pilot
activation and seven days of observations. No pilot, live conversion or external
action approval is implied here. Multiple devices/central service remain separate.

## Predicted acceptance examples

| Trigger | Observable behavior |
| --- | --- |
| Timer emits A/B | Accept both durably; A's consumer completes while B is held. |
| Human gate pending | Only affected deliveries wait; unrelated queues proceed. |
| Member paused | Automatic subscription dispatch stops; accepted inputs remain. |
| Same source version repeats | Return original receipt; no second normal fan-out. |
| Stale data writer emits output | Reject complete transaction; no output event appears. |
| App stops after uncertain HTTP | Retain unknown effect and work; no automatic resend. |
| Caller pauses while workflow finishes | One correlated result remains pending until explicit processing/resume. |

## Decision log

- October 1: owner approved M0–M14; no renewed approval required.
- Separate network storage/semantics and unchanged legacy representation implement
  the approved additive compatibility default.
- Explicit sourceItemId and caseRevision freeze previously implicit identity/join
  fields; they do not expand scope or authority.
- Local bounded schema subset needs no new dependency; remote/executable schemas
  remain excluded. M1 must verify the limits before production implementation.
- Existing WAL/FULL settings are retained; no central database or framework added.
- Portable backup excludes credentials; existing paired stopped-profile/keychain
  recovery remains necessary. M2/M13 must prove preservation, not infer it from
  the portable archive.
- Sharing file slice is an approved M11 dependency; invitation delivery stays
  separately tracked. Live mail acceptance is still open under issue 1407.

## Implementation entry points and next acceptance

Existing graph contracts, WorkflowEngine/items/gates, scheduling scheduler/tick-step,
RunDispatcher/RunStore/script-entry, PodDatabase, backup/retention, central projection,
master reference/control and current renderer components are the entry points in
the approved plan. Extend established scheduling/recovery/storage/resources/backup,
worker-entry, layout, central, relay and protocol suites. No new runner or automatic
E2E/layout job. M1 must prove crash/epoch/transaction and volume boundaries before
M2 chooses the next available schema number and enables no network activation.
