# Pods persistent networks: frozen M0 contract

Status: implementation contract approved through the October 1 plan. M0–M8
are accepted and merged; M9 implementation and acceptance are in progress. The original M0
increment froze these contracts; milestone evidence below records actual delivery. [Development issue 1417](https://repos.openape.ai/patrick/monorepo/issues/1417)
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
`caseRevision` is a runtime-controlled positive integer with retained supersession.
Case IDs and revisions cannot be supplied by model output. Event UUIDs
identify individual accepted facts. Source item/version identifies provider input.

One mutable instance has at most one persistent home network and one active
invocation by default. Network/group/instance owner and company must match.
Existing workflow reservations continue to arbitrate workflow instance access.
A network calls a finite workflow via declared ports; it cannot reserve that
workflow's instances itself. Before adding network membership, reject any existing
legacy composition membership except the reviewed atomic M11 cutover; also check
membership from legacy save/delete and standalone scheduling/dispatch paths.
A member's automatic intake belongs solely to its home network. Explicit workflow
calls use distinct workflow instances, preserving the existing instance arbitration.
Group movement with live bindings is refused in PodGroups.execute and every
runtime/relay organizing command until an explicit owner-reviewed rebinding.
Pod deletion and group removal likewise refuse live network/data/artifact bindings.
New foreign keys restrict deletion of bound groups; membership cascade never
changes company authority. Ungrouped existing Pods remain standalone until the
owner selects a company; do not infer one from names or archived profiles.

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
This deliberately changes cross-domain slot admission fairness in M4, while
preserving finite dependencies, output/retry semantics and existing reservations.
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
The compiled schema is limited to 16 KiB. Sort property names, required names
and scalar enum values deterministically before pinning/hashing. Preserve array
value order. Build accepted metadata from validated plain data properties once;
reject accessors, sparse arrays and custom serializers. Reject strings over
1,024 UTF-16 units before counting code points or encoding bytes. Canonical
event digests sort object keys recursively; producer key order never creates
a different payload receipt. Values are not Unicode-normalized or coerced.

A channel pins `{name, title, schemaVersion, schema}`. A positive schema version
is immutable; changes create a new version and an explicit compatibility review.
Channel names retain the current technical naming rule. The initial network
revision supports 64 members and 32 channels, at most 1 MiB of compiled contract,
50 inputs from one case/revision per invocation and 100 selected invocations
per reviewed Process now request. Member/channel display order remains pinned
and significant for the definition; it is excluded from source/derived identity.
Private staged checkpoints are limited to 64 KiB and commit only on successful
settlement. These conservative local bounds grant no authority. Jev/model outputs are
untrusted: validate both the metadata schema and allowed output channel.

Accepted envelope:

```ts
interface NetworkEvent {
  eventId: string
  networkId: string
  channel: string
  schemaVersion: number
  caseId: string
  caseRevision: number
  origin: SourceOrigin | DerivedOrigin | ReplayOrigin
  key: string
  producerPodId: string
  causationId: string | null
  networkRevision: number
  podDefinitionVersion: number
  invocationId: string
  occurredAt: number
  acceptedAt: number
  payload: Record<string, unknown>
  feedbackHop: number
  identityHash: string
}
interface ReplayOrigin {
  kind: 'replay'
  originalEventId: string
  replayAttemptId: string
  effectsPermitted: boolean
}
interface SourceOrigin {
  kind: 'source'
  sourceBindingId: string
  sourceItemId: string
  sourceVersion: string
}
interface DerivedOrigin {
  kind: 'derived'
  inputEventIds: string[]
  producerPodId: string
  emitKey: string
  feedbackTransitionId: string | null
}
```

Runtime generates UUID, acceptance time, producer identity, invocation identity,
case identity/revision and feedback hop. It obtains sourceBindingId from the pinned
trigger/binding, never a script string. Provider identifiers/versions are validated
against that binding's declared adapter and watermark policy.

Source acceptance identity is `[owner, networkId, sourceBindingId, sourceItemId,
sourceVersion, channel]`. Definition/schema versions are pinned receipt metadata,
not new acceptance identities: a schema bump cannot fan out the same normal source
again. Same identity and schema/payload hash returns the original receipt; changed
schema/content is a visible conflict requiring reviewed migration or explicit replay.

Derived event identity is `[networkId, producerPodId, sortedInputEventIds, channel,
emitKey, feedbackTransitionId]`. It excludes invocation/attempt and version bumps
so ordinary retry returns the same receipt. A source producing multiple facts uses
declared output channels or child entity keys; derived fan-out can emit two invoice
keys from one email. Duplicate emitKey with different content conflicts. `key`
preserves the legacy item key in an explicit adapter; it is not case identity.
FeedbackTransitionId is runtime-issued and unique per delayed transition, not an
arbitrary model-controlled value. Normal/derived/replay namespaces are distinct. `network_event_identities` retains
`UNIQUE(network_id, namespace, identity_hash)` independently of event retention.
Compute identityHash over canonical ordered tuples; sort input IDs, encode null
feedback transition as a non-null canonical sentinel, and never use nullable
UNIQUE columns as the deduplication boundary. Same identity retains receipt/schema/
payload hash after event pruning. ReplayOrigin uses a runtime-generated reviewed
replayAttemptId; it references the original event receipt without replacing its
source or derived marker. The replay marker's identity is `[originalEventId,
replayAttemptId]`. Marker policy also protects derived identities while an input,
approval, business revision or retry can still refer to them.

Case creation uses `network_cases` and `network_case_sources`: runtime atomically
maps the validated source binding/item to a generated case UUID and revision. New
source versions advance a recorded integer revision under the case transaction.
Derived events inherit case/revision from their claimed inputs; mixed cases are
refused unless a declared split creates child cases with retained parent ancestry.
Cross-source joins require an owner-declared deterministic correlation binding
(e.g. exact validated business key) and revision authority. Runtime looks up its
mapping; a model cannot choose a foreign case, reopen a superseded revision or
invent equivalence. Missing/ambiguous correlation enters review. There is no
implicit fuzzy match. Case revisions retain supersession and completion/deadline
state; late input cannot attach to a newer revision without the declared rule.

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
binding authority in a short database transaction. Authority has three scopes:
(1) runtime boot epoch revokes all pre-restart/restore callbacks; (2) network
activation epoch revokes that network on restore or explicit destructive cutover;
(3) per-delivery claim generation/token advances only a reassigned delivery.
Reassigning one delivery does not invalidate healthy claims in another branch.
Ordinary pause advances no epoch, because active work may settle. Epoch scope
includes a cryptographically random authority incarnation; restored numeric values
cannot reuse authority. Startup creates a fresh runtime boot nonce for claims.
Restore creates a fresh network restore nonce before any read/write authority is
reissued, using OS randomness outside the backed-up counters. Gate approval
manifests bind that restore nonce; every pre-restore approval is obsolete even if
all restored numeric revisions match. Normal restart preserves pending decisions
under the unchanged restore nonce, revalidates the pinned action and claims with
fresh boot authority. Existing
run_leases remain the exclusive per-instance process lease across all domains;
network claims add delivery authority, not a competing instance lease. Every
network invocation also has its own random token/generation, including timer
sources with no delivery claim. Stop invalidates that invocation only; source
callbacks cannot rely solely on a network-wide epoch or legacy run state. Lease expiry does not prove
process termination. Stop or prove termination before reassignment, then advance
the delivery generation. A timed-out async callback cannot commit with its former epoch.
Existing `boundedStep` uses Promise.race without cancellation: retain it for legacy
call sites, but do not treat it as authority fencing for new network operations.

Successful settlement atomically acknowledges inputs, applies staged collection
writes and tombstones, records revisions/provenance, accepts buffered emits and
creates deliveries/change events. Check all permissions and expected revisions
before changing anything. A rejected or failed settlement publishes none of those
outputs. Reads see invocation-local staged writes. No external await occurs while
holding SQLite's write transaction. Include run completion, network checkpoint
advancement, local effect receipt references and release of the owning run lease in
this same settlement transaction. Network invocations stage private checkpoints;
they cannot use the legacy immediate checkpoint commit. Keep legacy finish/item
transactions unchanged; the new path must not copy their separate-commit boundary.
Database remains local WAL, synchronous FULL,
foreign keys ON; never put the file on a shared network filesystem.

External actions remain outside that transaction. For legacy runs, EffectLedger
retains its existing caller-supplied key contract. For network runs, the runtime
requires a declared action port and computes `[owner, podId, caseId, intendedAction,
businessObjectId, actionRevision]`, binding the validated input digest and original
grant manifest. IntendedAction/object/revision come from the pinned declared
operation and authorized case record, not an arbitrary LLM key. Feedback hop,
invocation and redelivery are excluded. Effect begin checks current runtime,
network and claim authority plus exclusive run lease immediately before dispatch.
Late/fenced callbacks cannot issue a new external action. Ordinary retry reuses
the logical key and input digest.
Confirmed effects return their receipt without resending. Intent/unknown outcomes
block automatic retry until explicit reconciliation. Network reconciliation retains
append-only evidence of `confirmed_applied | confirmed_not_applied` and the owner
receipt. `network_effect_attempts` identifies `(logicalActionKey, attempt)` and its
owning run; `network_effect_receipts` appends `(key, attempt, sequence)` transitions
and results. One active attempt per logical key; retained confirmed-applied state
suppresses further execution across attempts. Confirmed-not-applied permits an explicit new attempt only with current
authority; it does not erase the old intent/unknown audit. Legacy reconciliation
currently deletes a not-applied ledger row; retain that legacy behavior, but do
not use it as the network evidence policy. A new feedback hop cannot
change the key for the same intended effect. A locally transactional conflict can
retry only after the classifier establishes that no external effect is uncertain.

Transient infrastructure failures get at most three total attempts with jittered
bounded backoff. Permission/invalid-data failures are blocked for review; exhausted
transient attempts are visible. Retry time and attempt count are durable. Replay
creates an explicit attempt identity, links its original event and states whether
effects are permitted; replay does not delete markers or confirmed effect evidence.

| Transition | Authority and evidence |
| --- | --- |
| pending/retry_wait -> claimed | Runtime scheduler, due deadline, exclusive instance lease and new claim token. |
| claimed -> done | Owning fenced successful atomic settlement only. |
| claimed -> retry_wait | Safe transient classifier, proven process stopped, no uncertain effect; bounded attempt/deadline. |
| pending/claimed -> blocked | Validation/permission/conflict or exhausted retry; retain concrete reason. |
| claimed -> unknown | Possibly issued external effect or consumed grant without settlement; never automatic redispatch. |
| blocked -> pending | Owner-reviewed correction of binding/schema/baseline, current authority and safe-effect classifier; retained reason/review receipt. |
| retry_wait -> blocked | Attempt exhaustion, revoked authority or invalidated input; never spin or silently discard. |
| pending (held) join inputs -> blocked | Recorded join deadline/incomplete outcome and review; no late automatic reopening. |
| unknown -> blocked/pending | Owner reconciliation evidence, current authority and explicit reviewed retry. |
| blocked/pending -> discarded | Owner-only recorded resolution after effect/reference reconciliation; retain tombstone/audit, never automatic quota eviction. |

Keep source markers at least 90 days and longer than provider replay horizon;
otherwise require a durable reviewed watermark. Event pruning cannot remove a
marker. Keep unresolved deliveries, gate manifests and uncertain effect evidence.
Completed trace retention is seven days or 10,000 events per network within its
byte budget; compact aggregate history is 90 days. Quotas pause/refuse intake before
source checkpoint advancement and show the reason; never evict unresolved work.
M1 measurements select a 192 MiB authoritative database admission target, with
64 MiB of headroom below the 256 MiB compacted-backup ceiling. Apply retention
and account for the whole profile, including indexes; refuse intake without
checkpoint advancement when retained/unresolved state cannot fit. See
[prototype findings](prototype-findings.md) for limits and later runtime gates.

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
set owner verification. Known credential/secret declarations use typed protected-store references only,
never their values. Reject credential-bearing binding fields and secret-declared
configuration in events/collections/exports; runtime APIs never resolve a secret
reference into those outputs. Arbitrary bytes cannot be proven secret-free by a
heuristic, so do not claim generic secret detection. Preserve existing sandbox and
review boundaries for scripts with legitimate secret-reading rights.

Artifact scope is a runtime-generated UUID identifying an owner/company collection
or explicitly private network artifact area. `artifact_scopes` names that target;
it never defaults to the whole company. `artifacts` references one scope UUID and
`artifact_permissions` binds specific scopes and operations to concrete instances.
Cross-network same-company sharing needs an explicit scope binding.
`context.artifacts.create` stages immutable bytes under that scope, with hash,
size, media type and artifact UUID. `read` accepts a scoped artifact reference;
it never returns an ambient host path. Artifact IDs are identifiers, not
capabilities: every read/create checks an explicit per-instance artifact binding,
owner/company, permitted operation and current authority, even for an ID found in
an untrusted event. Stage bytes in a private temporary file, verify size/hash,
fsync, atomically rename to immutable managed storage and fsync its directory
before SQLite publishes references. A crash before reference commit leaves an
unreferenced orphan eligible for safe collection; a commit never references
unstable bytes. Recheck authority immediately before reference commit. References
track business, delivery and gate usage. Retention deletes bytes only after all live references expire.
Quota and backup coverage include retained bytes. Existing Pod checkpoints and
snapshot APIs retain their private semantics.

## Workflows, joins and human gates

Workflow call contract declares input/output port schema versions, permitted
caller networks, required terminal branches and required owner gates. Request
contains request UUID, case ID/revision, caller network revision and pinned
workflow revision. `workflow_revisions` stores immutable composition content;
its version is distinct from the existing mutable workflows.revision concurrency
counter, which also changes on pause. Publish/pin the immutable content before call
acceptance; preserve existing legacy per-run snapshots and counters. Conversion
ancestry includes the frozen content/hash, not just a pause-sensitive counter.
Accept and persist the call receipt before dispatch. Repeated
request/hash attaches to one execution; conflicting hash is refused. Distinct requests queue FIFO for the called workflow;
its existing one-active-execution/reservation contract remains. A call never attaches
a different case to an already active legacy run. A blocked workflow exposes
head-of-line waiting for its queued callers without holding any network lease;
other workflows/consumers continue. A terminal
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

Gate tasks are non-script maintenance under the downstream Pod identity. Each
maintenance step acquires the exclusive instance lease and a fresh step token
bound to the current task generation. Supersession/cancellation advances that task
generation; every step checks both generation and token before committing.
The exclusive instance lease prevents polling/consumption from overlapping the
Pod's invocation or another gate step. Each bounded poll/consume step creates a maintenance run row
with the downstream pinned script hash as identity metadata and
`executionKind: network-gate` as the semantic classification (stored as the
reserved SQL enum `gate_maintenance`), without launching that script. Its task attempt
references that run UUID and reserves the existing run_leases row/global slot
for the bounded step only. Release slot/instance lease after the step; a pending
task holds no lease while waiting for the next poll or owner. Gate runs have the
same publication filtering and backup-idle checks as network script runs.
Poll steps are bounded and cancellation invalidates their token.
Approved release is bound to a specific action manifest/expiry; paused queues do
not extend grant validity, and dispatch revalidates it before an external effect. Keep
task states preparing, pending, consuming, approved, denied, expired,
superseded and unknown distinguishable; excluded is a retained per-item outcome. Freeze item IDs/hashes, consumer identity,
definition/binding/resource revisions and manifest digest before requesting a
grant. Exclusion supersedes the batch and requests fresh approval. Changed payload
or authority invalidates release; old evidence is viewable but cannot authorize
new work. When only the consumer authority changed (definition, binding, resources
or configuration), undecided and not yet consumed inputs return to a fresh approval
instead of blocking; the earlier grant is never reused. A paused member may change
its script and rights through `updateMemberScript`; that update supersedes the
member's remaining approvals the same way, because they covered the earlier
script. Persist consuming before one-time grant consumption. An interruption
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

Ordinary edges remain acyclic. M12 (implemented) adds `feedback` declarations in
definition format version 4: `{ id, podId, channel, delayMs ≥ 1000, maxHops ≤ 3,
maxCaseAgeMs ≤ 86400000 }` on a consumer's declared output channel. Only the
declared edge is excluded from the cycle diagnostic; `feedback-bounds` reports a
declaration without a consumer. The runtime computes `feedbackHop` from the input
events (unchanged through ordinary derived events, plus one through the declared
transition) and `feedbackTransitionId` as the digest of the declaration id and the
sorted input event ids, which enters the derived identity so a re-emitted transition
returns its receipt instead of a second delivery; a second emit key for the same
transition is refused. Workflow-call results inherit the highest hop of their case
revision and pass through the same rules, so a call inside a loop cannot reset the
count. Deliveries of a transition carry `ready_at = accepted_at + delayMs`; a hop
beyond `maxHops`, or a case revision whose age plus the delay exceeds
`maxCaseAgeMs` (`delayMs ≤ maxCaseAgeMs` is enforced), stores the event but creates
blocked deliveries and a `feedback-review` trace event carrying the event id and
reason. The owner resolves held feedback with `discardFeedback` (event id plus
evidence): the deliveries become `discarded` with a review receipt and a
`feedback-review-resolved` trace event, which unblocks replacement and archival.
A feedback channel cannot be part of an explicit join. Pause stops dispatch through
the existing reservation rule; the only production network effect writer is the
mail archive port (below), and the effect-key contract above excludes the hop. Known limits: the delay and the hold
apply to every subscriber of the feedback channel; a fresh gate approval resets
`ready_at`; a workflow-call result inherits the highest hop of its whole case
revision rather than of its causal chain, which can hold a parallel branch early;
Structure lists declarations as text without marking graph edges.
Portable network documents use the current definition format (see below) and always
carry `routes`, `joins` and `feedback`. There is no unrestricted LLM-controlled loop.

### One network format (issue 1455)

Definition format 6 is the only stored and portable network format:
`{ formatVersion: 6, …, channels, members, routes, joins, feedback }`. Owner
decisions exist once, as routes: a choose route picks one output per item, and an
approve route `{ key, title, kind: approve, takes, gives, excluded }` holds items in
front of exactly one consumer, which takes `gives` and never `takes` directly. The
runtime derives the held consumer and its subscription channel (`takes`) from the
route; formats 2 to 5 stored the same facts a second time as a gate binding
`{ key, title, podId, channel }`. Schema 42 rewrites every stored revision once and
recomputes its content hash. Gate tasks, items, choices and traces keep their keys
and stay decidable. A binding without a matching route cannot be expressed and stops
the upgrade instead of dropping an approval. Older portable network documents are
refused; export them again from the current version.

The owner decides each item grant of an approve route at the IdP as `once` or
`always`. Both stay bound to the item's exact command, audience, Pod identity and
batch expiry. Release consumes a `once` grant; an `always` grant is confirmed as
valid instead, and every archive move still requires it to be approved at that
moment. A denied or revoked grant releases and moves nothing; `timed` decisions
are refused. Once every input of a batch is done or discarded, or the batch was
denied, expired or superseded, the desktop revokes its still approved `always`
grants as the requesting Pod (`/api/grants/:id/revoke`, a few batches per minute)
and records `gate-grants-released`. A failed revocation is logged and retried with
backoff and never blocks processing.

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
never append full network/business tables to `centralTables`. Store network
manifests/inputs/checkpoints in `network_invocations`, not legacy accepted_events
or run_inputs payloads. Existing runs may retain only bounded generic status.
Committed private network checkpoints live in `network_checkpoints`, separate
from legacy checkpoints. Before the first network invocation in M3, apply a closed
default-deny classification across every centralTables entry: any row associated
with a network member, invocation, gate task, case or their derived records is
excluded unless an explicit bounded public-summary projection allowlists fields.
This includes checkpoints, recovery_reviews, schedules, claims, resources and
indirect run/member foreign-key paths, not just runs/run_events/effect_ledger.
Unknown/unclassified ownership fails publication rather than leaking a row.
Approved Pod/name/status/queue aggregates are rendered as explicit summaries,
not copied full table rows. No network business/checkpoint/effect body may be
stored in a legacy table used by unfiltered publication. Retain backup coverage
independently; add no new full-table payload leakage. New network effect evidence remains in `network_effect_receipts`.
M10 completes negotiated bounded summaries and paginated details; privacy cannot
wait for M10 while M3 writes network state. Runtime-mediated
owner-authenticated details fail clearly while offline. M10 negotiates compatible
versions before new writers ship; relay cannot claim deliveries or settle records.
Classify network reads as owner-authenticated bounded details. Network activation,
resume, source Process now, replay with effects, data/rights rebinding, conversion
and gate decisions remain desktop owner-review actions until the browser's existing
authority contract explicitly supports them. Do not tunnel them through legacy
runs:start, scheduling:lifecycle or workspace:organize. Ordinary safe browser
views/pause/cancel preserve current scoped restrictions and version negotiation.
Deploy the compatible relay first, then the signed desktop candidate. Restore
pauses networks/triggers, revokes claim authority, marks possibly issued actions
unknown and preserves markers/receipts present in the backup. A backup cannot know
effects issued after it was created. Every restored network therefore requires a
reviewed source baseline/watermark and effect reconciliation before any resume,
source Process now or replay. Mark restored claimed deliveries and consuming gates
unknown/blocked; intent rows cannot become fresh executable work. Preserve legacy
gate batches/reservations as blocked evidence, never transfer them into new claims. Do not overwrite later owner data or rotating
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
E2E/layout job. M1 budgets include existing backup ceilings: 256 MiB database/per file, 100,000
files and 10 GiB total. Business revision retention is an explicit collection policy
with unresolved references protected. M2 extends artifact allowlists, required blob
inventory, network-idle checks and restore coverage before any activation.
M1 must prove crash/epoch/transaction and volume boundaries before
M2 chooses the next available schema number and enables no network activation.


## M2 storage refinements

Schema 28 is additive. Network-owned tables and guard indexes are checked against
application-owned DDL at opening; backup and restore additionally check foreign
keys, owner/group boundaries and stored content digests. Immutable JSON digests
bind the exact stored UTF-8 serialization. Historical events and record provenance
retain their pinned definition versions; validation compares stable owner
boundaries rather than the current instance version.

Effect attempts and gate attempts use composite network/run and network/case or
network/task foreign keys. Logical effect keys remain global because the frozen
owner/Pod/case/action/business-object/action-revision tuple denotes one logical
action across retries and network revisions. Confirmed applied receipts must
continue suppressing execution in the runtime handlers.

Encrypted backup format 1 is additive to the existing portable plaintext format.
AES-256-GCM authenticates the manifest and each opaque file. HKDF-SHA256 derives
one archive key from the explicitly supplied protected 256-bit key, random
256-bit salt and format/key-reference context; random 96-bit nonces distinguish
files and manifest. File counts and ciphertext lengths remain observable.
The clear header contains format, version, key reference, salt, nonce and tag.
The authenticated encrypted manifest binds file paths, opaque IDs, nonces, tags,
sizes and SHA-256 checksums. The encrypted manifest has an independent 32 MiB
ceiling; long paths can reach it before the 100,000-file ceiling. Keys are copied and zeroed locally; owner key
provisioning and the encrypted data-control UI remain M9 acceptance work.

Plaintext export/unseal stages are private local application siblings keyed by
profile path, outside the chosen export target and profile. Worker initialization
removes abandoned plaintext stages before normal recovery. Only ciphertext stages
are written to the export target. A restored profile is plaintext application
state, intentionally paused; this format does not encrypt the live database.

Restoration records one bounded authority-revocation summary per network, rather
than a trace row for every historical invocation. Restoration retains archived networks, reasons, review receipts and staged
checkpoint evidence. It rotates every invocation authority and gate-step token,
blocks effect-free unfinished work, marks uncertain effects/steps and running
calls unknown, supersedes undecided gates and fences approved grants by the new
restore nonce and mandatory baseline review. Legacy gate batches with a pending
or consuming decision become unknown while preserving their concrete evidence.


### M3 admission and publication boundaries

Network creation is denied before mutation on a central-connected runtime until
M10 supplies bounded publication. An existing network profile continues to fail
closed for legacy whole-profile publication; this is not browser parity.

A clean failed or cancelled invocation blocks its own deliveries, but does not
fence unrelated ready cases for the same instance after its lease is released.
Identity conflicts, uncertain effects and interrupted invocations remain fenced.
Only M4 recovery may inspect and release retained leases or requeue blocked work;
M3 never automatically retries an uncertain external action.

A network pause terminates its outstanding Process-now admissions while allowing
already admitted work to settle. A new explicit preview can process a paused
network. Paused-instance selection must match the instances actually paused, and
each subsequent admission rechecks the original configuration fingerprint.
Successful settlement rechecks resource epochs after asynchronous native stop
proof. Revoked execution discards buffered outputs, retains its uncommitted staged
checkpoint for inspection, fences its claims and retains the lease.

The working M4 implementation adds schema 29 without altering schema-28 DDL.
Source clocks, Process-now previews/consumption, retry lineage/deadlines, snapshot
receipts and review flags use dedicated control storage. Historical manifests stay
unchanged as evidence; new invocation manifests contain immutable execution pins.
Only safe completed traces may be pruned after settlement receipts are retained in
control storage. Unresolved decisions/effects and acceptance markers remain intact.
The workspace admits at most 64 networks. M4 also bounds retained Process now
previews to 64 per network and five-minute authority. Expired unused previews are
removed; a preview referenced by unresolved work stays. A completed invocation
stores its approved preview in its durable settlement receipt before releasing
the preview reference. Completed runtime diagnostics can then be pruned without
removing unresolved, owner, acceptance or effect evidence. Quota remains a whole
profile admission budget; saturated intake pauses until explicit owner resume.
M4 clean runtime `0e5eaed96485cee586475727481d6a5c396753f7` passes root
lint/typecheck, build, 999 fresh unit checks, five selected manual native checks
and exact-head unit-only CI 5315. Two unrelated native crash cases are skipped
by selection. [Verified private Test Runs evidence](https://report.openape.ai/r/5WUpVPNReI22uBWBuzGVbh0P)
includes the personally inspected desktop screenshot and actual Opus 5.5 closure.
Three-network source transaction volume reaches 16,503 events / 49,503 deliveries;
50-item settlement p95 is 58.62 ms. Four real SQLite writers retain all 4,000 rows.
Bindings are fixture seeded; M5 gates, M6 records and the complete dependent
business fixture remain unverified. Scheduler/lease fairness uses mocked script
execution at 1/2/4/8 slots, not native-script latency evidence.
Final documentation head `1cb0d57aa3b9f1fbf192c7832ff5698d4cbc2e34` passed CI 5316;
PR 204 merged as `49dce16e93b7cc4ae07992b84f6eded9c103307c`. M4 is accepted.


### M5 implementation progress (unaccepted)

Schema 30 adds gate controls, issued-operation journals and per-delivery outcomes;
historical schema-28/29 DDL is byte-identical to canonical M4. Explicit network
format 2 declares approval gates on downstream subscriptions; format 1 and legacy
v1 gate command/summary bytes remain unchanged. Maintenance reserves the pinned
downstream/global lease for at most 30 seconds without launching a script/model.
Each step counts toward the existing bounded Process-now admission budget.

Held inputs require consumed-grant coverage during ordinary admission, active-grant
verification through the main DDISA authority before actual script launch and fresh
local coverage at settlement. Public script coverage contains only the gate key and
its current approved inputs; owner, grant and restore authority remain private.
Gates require an existing prepared Pod identity and cannot provision one implicitly.

Persist an issued operation before create/status/consume, and persist consuming
before sending the once-consume request. Unknown create/consume is never repeated;
a late observed create ID is retained as evidence without releasing approval.
Read-only status failures retain pending inputs with backoff. Keep the last four
safe status-step records and monotonic poll/pruning counters; preserve create,
consume, unknown and owner receipts. Maintenance does not displace script history.

Owner-only exclusion supersedes the old grant and freezes a fresh batch for the
remaining inputs. Unknown, obsolete or previously consumed blocked work needs explicit
`gateReview`, fresh validation, stopped-process evidence for prior executions and
no applied/uncertain external action before requesting a new grant. Generic gated
retry rejects before mutation. Gated and ungated channels are claimed in separate
batches even when they share a source case; separate gated channels also remain
independently recoverable. Restored maintenance with stale or missing stop proof
remains visible in lastFailure despite a retained resolution, so explicit inspect
can establish current stop evidence before owner disposal. Owner decisions nest
prior item and resolution receipts, including maintenance inspection. Confirmed
non-application permits explicit fresh gate review; an uncertain or applied action
still rejects it. Failed sibling cases do not revoke valid approval
for other pending cases. Unknown disposal retains the uncertain grant/attempt
receipts. Restored v2 control outcomes are revoked without rewriting legacy
reserved gate rows; mandatory baseline review still prevents fresh approval.

Clean runtime `c170a7c28e3a8b836ea656018f48284eaee1f708` passed root
lint/typecheck, Pods build, 135 files / 1,025 fresh unit tests and seven manual
native checks (two unrelated crash cases skipped). Actual signed loopback once-grant
consumption followed by worker SIGKILL before its response and desktop restart
retains unknown state, unchanged maintenance attempts and no gated script; explicit
owner disposal never consumes again. Both screenshots were personally inspected:
Ready, signed-in synthetic owner, three company cards and recovery card without
clipping. Cards remain labelled Standalone Pods until M9; gate outcomes are proved
through actual IPC/SQL assertions, not an operational gate panel.

Repeated actual Opus 5.5 reviews confirmed safety closure. Primary review verified
all 33 files / 2,566 displayed native lines against source/target commits, including
the generic maintenance-disposal guard before inspection. Runtime exact-head CI
5318 passed the unit-only contract. [Verified private Test Runs receipt](https://report.openape.ai/r/0vlx3rT-L2Q2NdG5kbgYizCT):
category Test Runs, owner read 200, anonymous read 401 and both inspected screenshot
bytes retained. Initial default-run timeouts stopped before push; nine affected
suites passed with one worker and unchanged timeouts, then full default runs passed.
No runner/CI/timeout change. Final documentation head `dbbb2f29` passed CI 5319;
33 files / 2,585 native lines matched canonical commits. Protected PR 205 merge
`710c7b65af5a8d4c8e6a2753c75caeaf0dd5aa6d` completes M5 acceptance.



M3 is an engine vertical slice using explicitly seeded owner/definition bindings
in isolated fixtures. The productive definition/instance writer arrives in M8;
it must follow accepted M4 recovery so interrupted leases have an owner inspection
and release path before any productive network can be created. No owner-facing
creation or production readiness is claimed by M3.


## M4 recovery and scheduling scope

Owner conflict resolution binds the current network revision, invocation generation
and conflict identity hash. `retainOriginal` requires the original durable event
marker to match the recorded conflict. When a conflict inside one settlement
rolled back that tentative acceptance, the owner must explicitly choose
`discardBatch`; the receipt records that no original acceptance survived.
Both decisions dispose of the original failed input batch atomically and retain
truthful owner evidence without marking an unconsumed retry as consumed. The conflicting batch
cannot be retried. Uncertain external effects must be reconciled first. Owner
requeue records old and current namespaces and whether they differ; restored baselines remain
fail-closed until the later migration baseline review is implemented.

Controlled master and existing browser run starts enter the standalone position
of the same domain rotation. Their explicit within-domain manual priority cannot
bypass a workflow or network that currently has the first admission position. Startup, suspend,
maintenance and central lease gates apply. A busy start fails visibly; no new
offline browser mutation queue is introduced. Remote run reservation and its
started receipt remain atomic. A failing scheduling domain records its diagnostic
and permits unrelated domains to continue; last progress denotes run admission.

Automatic retry accepts only trusted pre-launch InfrastructureError failures and
requires verified process stop, unchanged authority, the original batch and at
most three attempts. Current capability-free network scripts have no identified
production pre-launch authorization/read service that emits this classifier;
backoff/exhaustion are protected behavioral contracts, not evidence that arbitrary
current IO failures retry. M5 must retain this conservative boundary when adding
external action ports. Unknown or confirmed external effects never justify a new
automatic issue. Event/delivery/business compaction beyond safe diagnostic traces
remains dependent work; unresolved records and duplicate markers are retained.


Explicit owner disposal of failed work requires current revision/generation,
verified process stop, no uncertain effects and unchanged original input IDs.
It marks deliveries discarded with retained owner evidence, preserves checkpoint,
events, duplicate markers and effect receipts, and disables retry of that attempt.
Only then may ordinary diagnostics and the separately captured approved preview
be compacted. A consumed failed retry also retains its durable settlement proof;
its owner/effect evidence is never treated as an ordinary diagnostic.

Historical schema-28 rows with neither execution-domain evidence nor creator PID
remain fail-closed when a retained lease cannot be proven stopped. There is no
owner boolean that converts missing evidence into a safe automatic retry. Such
profiles require the later stopped-runtime migration/baseline investigation.

M5 preserves the existing single lastFailure projection. Historical missing
process-domain evidence remains fail-closed and may require manual investigation;
a blocked inspection can occupy that slot. M9 must provide a bounded operational
failure list so unrelated failures remain discoverable without weakening stop proof.


## M6 scoped data implementation and acceptance boundary

Schema31 is additive; schema28–30 DDL and existing identity/home/rights/graph state
retain their original representation. Collection and artifact bindings explicitly
name the owner/company/network/instance/operation. Reservation pins their revisions,
collection schemas/indexes, artifact-scope targets and effective configuration.
Input delivery, each API call and settlement recheck current authority. Process-now
previews pin this same configuration. A UUID identifier conveys no capability.

`context.data.get/put/delete/query` use the frozen contract above. At most100 staged
record mutations per invocation each use the preceding staged revision and retain
all committed revisions/provenance. Query uses a declared scalar index, a stable
key cursor, limit1–100 and the current invocation overlay; no caller SQL/host path.
Responses page within192 KiB of record JSON, below the existing256 KiB frame
limit; byte-limited pages retain the stable cursor without losing records. Get/query
and artifact reads hold a SQLite transaction across authority and value checks.
Keys reject unpaired surrogates; bytewise UTF-8 comparison keeps staged and indexed
Unicode keys/range values in the same SQLite order. Tombstones are null by default;
`get({collection,key,includeDeleted:true})` returns their revision, `deleted:true`,
null value and retained provenance for explicit revisioned recreation. A write-only
CAS operation exposes the current revision on conflict, never the record value.
Automatic infrastructure retries retain the original data/configuration pin and
block after changes; explicit owner retry journals a fresh pin and checks that
reviewed pin again at admission. Historical missing pins mean empty authority.
Owner-verified provenance cannot be set by scripts. Delete refuses unresolved
inputs/downstream outputs/author recovery; settled delivery state is `done`.
Writing then deleting inside one invocation commits both revisions and a tombstone;
only that invocation's newly committed revisions are exempt from its own stopping
state, while prior unresolved authors remain guarded.

Records, materialized indexes, provenance, emitted events, checkpoint and artifact
metadata share one SQLite settlement. A stale writer or late invalid emission
rolls back every output. A commit-time CAS conflict blocks the original invocation;
it requires the existing verified owner retry with a fresh run, rather than replaying
script/external work automatically. Scripts may handle a pre-staging CAS conflict
inside their existing authorized run. No new automatic retry class is introduced.

Configuration is distinct from legacy variables and business records, with visible
origin: Pod override > composition > definition. Secret declarations accept only
protected-store reference objects. No runtime port resolves their values into
business outputs; closed scalar schemas reject typed secret objects. No generic
secret-byte heuristic is claimed. Legacy variable conflict handling remains intact.

Initial `context.artifacts.create({scope,bytesBase64,mediaType})` and
`read({id,scope})` frames are limited to128 KiB decoded bytes (existing256 KiB
ScriptFrame limit). At most32 artifacts per invocation. Larger artifact creation or
reads are not implemented by these APIs; backup continues to preserve historical
retained artifacts up to256 MiB. Create is immutable and scope-specific, not an
ambient host-path API. Explicit read permission is needed even for a just-created
artifact reference. Bytes are hashed/size checked, written privately and fsynced,
renamed and directory-fsynced before SQLite publishes metadata. The read descriptor
uses no-follow, fstat, link-count/size/hash checks. Record/event/gate/invocation
references preserve bytes across trace pruning; event UUID refs must also appear
in hashed payload values. Existing business references remain conservative.

New v3 gate manifests bind data/configuration authority in their action hash and
command; changed rights/configuration require a fresh grant. Existing v1/v2 manifest,
command and summary bytes remain valid. Historical v2 network approvals can only
continue with empty shared-data/configuration authority; adding such authority
invalidates them before consume/release. The existing gate audience and signed
once-consumption protocol remain unchanged.

Uncertain/interrupted drafts remain forensic backup evidence until current stopped
process proof and explicit owner retry/discard/fresh gate review. That decision journals
body hashes/revisions/artifact IDs before abandoning uncommitted drafts; it never
rewrites committed records or uncertain effects. Restore revokes old authority and
retains drafts for review. Safe artifact metadata removal commits before file cleanup;
a separate writer transaction rechecks all live committed/staged hash references
before unlink. Successive100-name pages prevent orphan starvation and include stale
private staging files after one day. A poison entry is reported after other files
are processed. Each network/operation retains one bounded current maintenance
status and failure counter, plus one initial immutable diagnostic trace; successful
maintenance clears the current fault without growing traces on recurring faults.
Trace and artifact maintenance run independently while unrelated safe dispatch continues. Database
and managed-byte admission/settlement quotas remain enforced.

Clean runtime `e5050467cfb91f9ba0545ffe503bf370fc819526` passes root
lint/typecheck, Pods build,136 files/1,058 fresh units, including59 focused data/gate
authority contracts and five production SIGKILL boundaries. Eight selected manual
native checks pass; two unrelated crash cases are skipped. Actual native ScriptFrame
sharing and private binding-denial receipt are verified, with a personally inspected
clean-source screenshot. Existing Standalone labels remain M9; productive definition,
configuration and rights setup remains M8/M9. Repeated actual Opus5.5 reviews and
primary source/native inspection close the corrected findings, including SQLite
Unicode ordering and automatic/owner retry authority. All28 native files/1,873 lines
match canonical source/base commits. Runtime exact-head unit-only CI5322 passed.
[Verified private M6 Test Runs](https://report.openape.ai/r/EFk69QK5P2sGYg1yKqwwKA9w)
retains actual results and inspected screenshot bytes: owner200, anonymous401,
category Test Runs. No provider action or rights expansion. Final documentation-head
CI5323 passed at documentation head `360b4f07f4d49ca3b72f78afc9c3088573d16bfb`;
protected merge `e815dad04ecf0985a7a1bd0f6269604f5b55f46a` passed full main
unit CI5324. M6 is accepted. Continue M7; productive browser
parity, migration, sharing and signed relay-first rollout remain later approved work.

## M7 correlated finite calls and explicit joins — accepted

Schema32 adds call proposals, explicit company-bound call permissions, delivery
controls, per-Pod decision polling and immutable result-event relations; historical
schema28–31 SQL and format1/2 definitions remain unchanged. Format3 adds explicit
case-revision joins. A join accepts exactly one input per declared channel; missing,
conflicting and late inputs require owner review instead of mixing cases or reopening
completed work. Inputs received before the deadline remain eligible after a delayed
dispatch. Retry lineage problems isolate the affected join.

Named, versioned workflow ports bind an immutable published composition and validated
script/resource/member pins. Mutable owner pause counters remain a separate revision
kind. Legacy UUID-keyed handoffs remain supported through an explicit port adapter.
`workflow.call` stages a correlated request; only successful caller settlement accepts
it atomically. A retained logical receipt deduplicates repeated requests for the same
case/revision and inputs/routes, even when the caller supplies a different UUID.
Uncertain caller settlement accepts no child execution and retains proposals/effects.
Known safe infrastructure retries journal discarded unaccepted proposals.

Accepted calls release the caller lease, dispatch one finite execution per eligible
workflow and retain one terminal result. Paused callers retain completed results;
paused and busy entries do not occupy bounded dispatch/delivery windows. Current call
permission is rechecked before unfinished steps. Completed steps and external effect
receipts survive retries, cancellation, restoration and materialisation errors.
Required human decisions keep a call nonterminal; decision-only maintenance never
executes the consumer script, uses per-Pod backoff and retains bounded finished
history. Published approval gates require exactly one approved-channel Pod consumer
because consumed grants bind that Pod; use separate gates for independent approvals.
Conclusive denial, expiry, exclusion or a choice away from a required terminal settles
as failed once all branches finish and no pending input or held decision remains. Known pending gates become unusable after cancellation; unknown evidence
remains available for review, including after item retention and cancellation.
Call cancellation requires the original owner-evidence route; repeated requests retain
the first receipt and append a separate trace. Finished child outputs remain retained
until their call result settles.

A finite step receives its complete bounded scoped batch or fails before processing.
Unprocessed inputs cannot produce a successful terminal receipt. Oversized cases need
an explicitly reviewed definition; completed work never automatically replays to drain
leftover inputs. Restored calls stay fenced until `resumeCall` records owner evidence
and verifies stopped processes, retained effects, current baseline and permissions.
`resolveCall` explicitly acknowledges an incomplete result of already completed work
as failed, with a retained-work receipt; it never changes the completed child or
repeats its effects. Recorded cancellation intent finishes after process cleanup and
stops for owner review on uncertainty.

M7 runtime source `e7ae6e1cec20149ec31f12363930312e6c2226c5` passes root
lint/typecheck, Pods build,137 suites/1085 fresh unit tests and four manual native
checks through actual Electron preload/main/worker/ScriptFrame routes. Actual Opus5.5
closure reports no blocker; primary native diff review reconciles33 files/2659 lines.
Native PR208 is linked to issue1417 and runtime unit-only CI5327 passes.
[Verified private Test Runs](https://report.openape.ai/r/GeG_5EXS3PQGRtT0PJmGCcMS)
contains actual correlated invoices, paused-result retention, join outcomes and the
personally inspected authenticated screenshot. Final documentation `4b07e3ee67ea13d2b5c94da09cc47d03295cf444` passed CI5328;
protected merge `a836a97d192e1eeff9f440427806c6de5b35264c` passed full main CI5329.
M7 is accepted. Productive authoring, operational views, browser parity and
rollout remain their later milestones.

## M8 reusable definitions and isolated instances — runtime verified

Schema33 retains immutable published code, exact dependency artifacts, declared
contracts and public defaults separately from instance identities, homes and rights.
Adoption adds metadata without changing existing scripts, schedules or bindings.
Publication never repins an existing instance. Durable request IDs create at most
one paused instance; retries retain the same key and identity. Restored identities
require owner recovery before provisioning resumes. A recovered ready identity
reconciles its receipt without a new provider request. Grants and validation are
never copied; every selected version requires the instance's current validation.

Version review shows actual before/after code, contracts, dependency locks, defaults
and requested capabilities. Activation checks current binding/resource authority,
refuses retained work and uncertain effects, and atomically updates a paused network
revision. Generic activation cannot bypass selection by editing/removing a draft.
Published sources remain retained while reusable artifacts reference them.
Instance-specific HTTP/SSH/application capability UUIDs cannot be published before
M11 portable binding review. Connected workspace editing remains visibly fenced
until M10 parity; the local Script route supports English and German layouts.

Clean runtime `5cf5c7004b0c4fee850d3fb05a356421f3446370` passes root lint,
typecheck, Pods build,139 suites/1108 fresh unit/component tests and four manual
Electron suites/five tests. Tests retain important identity, restore, version-selection
and activation authority contracts. Actual Opus5.5 review closure and primary native
review cover38 files/1935 displayed lines; exact-head unit-only CI5332 passed.
[Private M8 Test Runs](https://report.openape.ai/r/11BVW8loYVf-rTWxSC5SMJAf)
contains actual results and four personally inspected desktop/narrow EN/DE screenshots;
owner200, anonymous401 and rendered bytes verified. Native PR209 links issue1417.
Final documentation head `8b2ba1ec280f6e95d645026b18ee39dabcc631d5` passed CI5333;
protected merge `9eaf5e4e70ae22ebebdf2f2c19c83376f7923b56` passed full main CI5334.
M8 is accepted.
No live provider action, production activation or rights expansion is included.

## M9 operational desktop UI — accepted in PR210

The owner chooses a finite workflow or persistent network, then selects prepared
instances in one company. A setup fingerprint binds the reviewed instance versions,
resource epochs and effective values. The public creation route requires that review;
creation is atomic and paused. Shared public values are opt-in, apply only to declaring
members, must match their declared scalar types, and never replace a Pod override or
expose a secret reference. Changing the reviewed selection resets dependent choices;
reviewing an unchanged fingerprint preserves the draft. Existing bounded graphs are
explicitly labelled and never converted by creation.

Structure displays independent source timers separately from recorded activity.
Process now requires explicit inclusion of each paused Pod, a bounded budget and a
fresh preview; completion neither activates timers nor resumes Pods. Read failures
cannot disable the network pause action. Member configuration failures remain visible
without hiding unrelated recovery records. Recovery evidence belongs to the selected
invocation, effect or gate input, and the stopped-process check precedes reconciliation.
Unknown external actions remain blocked until their outcome is explicitly reconciled.

Owner reads are bounded: 50 trace receipts, 50 unresolved invocation failures,
64 collection summaries, five record previews, and 256 resource summaries per member.
Trace fields use an explicit allowlist; grant tokens and raw authority objects never
leave the worker through these views. Activity follows actual case-linked acceptance
and settlement receipts. Data reads preserve version/tombstone information and enforce
same-owner/company collection bindings. Read commands do not mutate retained state.

Only already-assigned `mail.read` is permitted on source instances. Consumers cannot
request it, and other undeclared external ports remain refused. The existing exact
account/folder/attachment/history checks and provider authorization still apply.
Each invocation allows at most 100 mail reads and records operation/count metadata,
without mailbox content or credentials. No mail, accounting or notification right is
created or broadened. Connected creation remains fenced until M10 bounded publication;
the actual connected Electron entry has an explicit offline refusal path.

Manual acceptance uses the existing browser layout and native Electron suites.
Permanent tests protect scoped reads, stale review refusal, value origin/type rules,
paused consent, recovery availability and mail non-mutation; no CI job or runner was
added. Actual Claude Code Opus5.5 reviews supplement primary review; Patrick additionally
permitted Fable for UI/design, verified here as `claude-fable-5-1`. Their findings drive
corrections and fresh screenshot capture. M9 clean source, native review, exact-head
CI, private Test Runs and protected PR210/main CI acceptance are recorded in active work.


### Reviewed composition correction boundary

M9 creates immutable compositions and permits pausing them; it does not offer in-place
editing or archival. The Fable review identified that a mistaken composition otherwise
has no owner-facing replacement path. M11 must include an explicit, reviewed paused
replacement/archive path alongside membership cutover and sharing. It must retain
history, identities, pending decisions and effect evidence, and refuse unresolved
work rather than deleting it. This is a required pre-release follow-up, not a claim
that M9 provides editing or that an existing network can be silently converted.

## M10 bounded browser publication — accepted

Central format 2 and its existing part keys remain unchanged. A relay advertises
`networkReads: 1` before the desktop can publish a network profile or create network
work while connected. Network summaries use a separate additive `runtimes.networks`
column and do not increment the workspace operation revision. Publication runs at
most every five seconds; scheduler progress alone changes its signature at minute
resolution. The relay retains a bounded change cursor history.

Every legacy publication table has an exhaustive ownership policy. Network members,
retained invocations, called-workflow instances and their run-derived rows remain
local. Ambiguous global control/chat/mail state is excluded. Nullable creation rows
without a classified Pod are intentionally excluded, not presumed public. Explicit
Pod/name/status summaries replace private Pod details; managed workspace and script
artifacts are excluded too. Complete encrypted backup coverage remains independent.
Persistent health summaries replace free-text diagnostics with generic attention
indicators. Full diagnostic text is available only through an authenticated live read.

Browser reads use the existing private owner session, origin checks and runtime
registration signatures. The separate read lane accepts only list/detail/trace/records,
has a 20-second lifetime, a 2 MiB response limit and bounded global/owner/runtime
queues, and is never persisted or replayed as an owner operation. Disconnect, lease
replacement, expiry and abandoned HTTP requests invalidate reads. Optional read-lane
failure is diagnosed without closing an otherwise healthy runtime lease. Detail gates
have no approval URL. Legacy mutation guards run both at relay submission and again
inside the worker, including when an older relay lacks the guard. Individual pause
and cancel remain allowed; activation, replay, configuration and membership changes
require desktop review. Workspace-wide browser commands that affect network members
remain refused; this does not extend the existing browser command allowlist.

The shared browser UI keeps summary inventory separate from scoped details, retains
per-network decisions across summary polling, shows read loading/errors in their
respective views, and displays explicit offline failures. Network Pod entries show a
summary instead of mounting the legacy mutable editor. Existing unrelated legacy Pod
editors remain available. Five UTF-8 record previews are individually limited to
32 KiB; trace and record cursors use stable keys, not shifting offsets.

### Relay-first compatibility and rollback

Deploy and verify the compatible relay before distributing the new signed desktop.
An old desktop continues to use unchanged format-2 parts on the new relay. A new
desktop without network state can still use an old relay. A network-bearing profile
fails closed when the capability is absent: it cannot publish private full tables,
and its workspace gate pauses scheduling, including legacy schedules. This is an
explicit rollback availability cost, not successful online compatibility. Stop new
network writing before rolling back the relay; preserve the database and all effect
receipts, then restore the compatible relay to reconnect. Do not downgrade or convert
a network-bearing profile to the legacy runtime. The additive column leaves the old
relay database reader compatible. A future change to the read-view schema requires
new capability negotiation before its writer ships; unknown data must not be silently
reinterpreted. M13 owns actual signed relay-first deployment/health/rollback receipts.

Primary review and actual Claude Code Opus 5.5/Fable reviews informed this change.
The authenticated browser acceptance uses a real local identity provider, signed
runtime requests and the actual Nuxt route, with synthetic runtime responses. Native
Electron tests separately exercise the actual desktop/preload/main/worker routes.
These are distinct evidence; they do not claim an installed production desktop has
connected to a deployed relay. Clean runtime `0bcad342d2d96a4645c687358ba964b04c2b254c`
passed native/layout/browser checks, root gates and1136 Pods/34 relay/6 protocol tests.
[PR211](https://repos.openape.ai/patrick/monorepo/pulls/211) passed exact-head CI5338,
merged as `ad16a8f2cf4fa85864472c8cb8750d4feaed33cc` and passed full main CI5339.
[Verified private Test Runs](https://report.openape.ai/r/TIPZLLUeJrGCKBf0UE7ituvS)
contains the actual results and eight personally inspected screenshots. Its immutable
publication-time pending CI was subsequently resolved by those CI receipts.


## M11a reviewed conversion — accepted increment

Desktop conversion starts from the selected bounded channel graph. Its dry run
reads existing definitions, owner bindings, script hashes, local rights, values,
schedules and every member checkpoint. It writes neither database rows nor blobs.
Explicit typed schemas, source versioning and exact checkpoints are reviewed; no
source cursor or payload type is inferred. Unsupported gates or rights, published
callable workflows, conflicting membership, unresolved executions/inputs/recovery,
uncertain effects and pending decisions refuse conversion with settlement guidance.
Pending deliveries block by default. Explicit `retainLegacy` preserves them in the
disabled ancestor without importing or replaying them.

The current fingerprint is recomputed inside the cutover transaction. The old graph
is archived, its live memberships removed and individual schedules disabled; their
original definitions remain. The same Pods, identities, scripts, homes and resources
join a newly paused network. All member checkpoints are copied exactly. Original
checkpoint rows remain untouched. Activation is separate and starts no replay.
Shared values, setup authority and storage limits use the same validation in preview
and creation. Legacy graph values retain their string type and remain available to
unchanged scripts through `context.variables`; matching public composition values
also feed declared `context.config` fields. Conflicting Pod overrides refuse conversion.
The resolved legacy variables participate in the runtime data pin. Failed writes roll the complete cutover back, including schedules.

A protected `legacy-conversion-reviewed` trace stores the frozen ancestor and exact
checkpoint receipt and bounded exact retained-delivery IDs, keys and payload hashes.
A compact baseline pin avoids copying full checkpoints into
frequent authority fingerprints. Restore retains the protected receipt but revokes
the baseline, so an identical conversion retry is idempotent without reactivating
or bypassing restore review. Ancestor rows stay private in browser publication, including item/event rows whose
workflow-run row is absent. The privacy filter follows both workflow and run identity.
Only a bounded activity summary is shown in the network trace; detailed retained legacy
inspection is described below. Reviewed paused replacement remains a later M11 increment. Historical memberships and effect evidence may never be deleted to make
a replacement fit.

Source scripts must already support persistent execution using
`context.network.emit({channel,key,sourceItemId,sourceVersion,payload})`. A script
that also runs as a bounded graph or in ordinary validation must handle the absence
of `context.network` explicitly. Its bounded path may use `context.emit`; a persistent
source using that legacy API is refused at runtime. The conversion review pins the
unchanged script hash; it neither rewrites code nor treats the owner assertion as a
static proof of API use. Schema mismatches are refused at runtime as well.

Actual Opus5.5 and Fable5.1 reviews supplement primary review. Permanent behavioral
tests cover pure previews, original identities/checkpoints, atomic rollback,
restoration, pending retention without replay, unresolved authority and UI review
invalidation. Current source passes141 suites /1157 units, three native cases and
13 manual layout checks, root lint/typecheck and the Pods build. Six native and
wide/narrow EN/DE screenshots were personally inspected. [PR212](https://repos.openape.ai/patrick/monorepo/pulls/212) passed exact-source
CI5340 and full-main CI5341; merge `4984a2a31a1b463bf4fe248ece65d52772c50864`.
[Verified private Test Runs](https://report.openape.ai/r/m3ufyiHjZQKDMqlJqLVJ-ZTE)
contains the actual results and inspected screenshots. This increment does not complete M11: reviewed
replacement/archive and the approved portable file-sharing slice remain required.
No productive conversion, schedule activation or external action is implied.


## M11b reviewed archival and retained legacy inspection

A paused, settled network can be terminally archived after a pure fingerprinted
preview and explicit desktop confirmation. The transaction repeats the preview,
refuses stale authority or unsettled work, records a protected receipt and revokes
execution authority. Identical retries return the existing result. Archival never
releases historical Pod membership for reuse or deletes identities, scripts, rights,
homes, checkpoints, retained ancestor data or effect receipts. Existing diagnostic
trace retention still applies; protected conversion and archive receipts remain.

Pending deliveries, native/program leases, bounded processing, unresolved executions,
approvals, joins, calls and uncertain effects block archival. Completed workflow
results must also be delivered first. Definition updates share these checks so a
new revision cannot strand an old result. Completed gate task states, item receipts
and controls survive an archived backup restore. Archived summaries have no actionable
decisions, and processing, activation, updates and recovery refuse terminal networks.
Standalone Pod scheduling continues to exclude all historical network members.

Retained legacy inspection pages only the exact delivery identities in the protected
conversion receipt. It compares the original payload digest with the current original
row, labels missing or changed rows and renders a bounded text preview. Paging never
imports, executes or replays a delivery. Ownership and ancestor identity scope every
read; browser publication and browser command allowlists continue to exclude this
private desktop-only history. The UI names the affected Pods, displays digests and
truncation explicitly, invalidates stale reviews and places focus at new results.
Desktop previews use the existing read route, with no relay mutation operation;
central availability checks continue to apply.

Opus5.5 and Fable5.1 reviews supplement primary review and actual manual verification.
Permanent tests extend the existing suites for consequential settlement refusals,
preservation through restore, idempotency, ownership and terminal execution refusal.
Paused composition replacement and portable file sharing remain required for M11;
this increment does not activate production or convert any live graph. Case closure
is not currently written by the runtime. M12 must account explicitly for undelivered
workflow results before introducing closure; archival never silently discards them.

### Delta Mind compatibility correction (October 4, 2026)

Network definition format 5 adds `routes` using the existing explicit graph
choice and approval declarations. Choice inputs retain their original event and
case; the owner decision creates one deterministic derived event, preserves
independent subscriptions and is stored in schema 36 `network_choices`.
Every gate output, including exclusions, must match the input schema and version
before work can be admitted. Pending choices block composition replacement and archival. Restored baselines
cannot accept new choices. Browser access remains read-only.

A routed approval binds the existing exact consumer grant to the original input
channel. Only the approved consumer sees the declared output channel; event IDs,
payload hashes, generations and grant manifests retain the original input. The
output requires exactly one consumer, the identical schema and no alternative
producer. An explicit owner exclusion creates a retained derived event on the
excluded channel. Routed gates cannot combine with joins on their inputs or
outputs, or bounded feedback. Portable export of routed networks is refused until
its document format supports routes.

Network members use their own assigned resources exactly like standalone Pods
(owner decision October 9, 2026, issue 1455): sources and consumers invoke granted
application commands and mail reads (`tools.invoke`, also from the agent's
`ape_shell` tool), assigned HTTP destinations (`http.request`), their secrets
(`credentials.get`), assigned folders, Jev evaluations and `agent.run` through the
same dispatcher code path, with the same limits. There is no network read budget,
no source-only rule and no network-specific capability list. Authorization of
real effects is unchanged: every application command and HTTP destination needs
its IdP grant (with the existing 60-second per-run token reuse; changing or revoking a resource cancels the run),
executables and adapters stay hash-bound, effect keys keep HTTP writes idempotent
in the effect ledger, an unknown outcome holds the member until owner review, a
DDISA destination token is redacted from replies, and resources of another Pod
are never reachable. Network runs hold no per-run Pod runtime grant; the owner
activates the network instead. A member script's deadline is the standalone
script time limit plus the agent pause allowance plus one minute. The one
structural rule is the archive member below: its application is reachable only
through the approved archive port.

Conversion preserves every legacy route exactly. A terminal unsuccessful member
run is acceptable only after a successful recovery inspection and a terminal
cancelled parent workflow; its original run and inspection remain unchanged.
Unknown effects, live leases, unfinished runs and unresolved approvals still
block conversion. Pending legacy owner choices must be decided in the original
graph before conversion; they cannot become inaccessible archived choices. Pending legacy deliveries remain retained history and are
never replayed into the network.

The bounded mail intake example records an explicit initial sample of up to
three Inbox and three Sent Items messages. Each item is re-read with the
account-scoped upstream O365 workflow transport to obtain its immutable ID and
provider `changeKey`. A standalone baseline emits no items. Network runs require
that exact baseline and emit only observed changed versions. This sample is not
a full mailbox cursor, complete contact inventory or archive authority. Mail
with attachments remains incomplete until attachment evidence is available.

Existing instances can prepare a local immutable definition with public defaults
from their currently validated active script. This pins only that paused instance,
retains its identity, home, assignments and grants, and leaves the version
unpublished. Preparing an instance from a shared definition creates a separate
local definition and leaves the shared definition unchanged. Instance-specific program rights remain forbidden for reusable
publication and instantiation. A network member preparation must pass the same
paused, settled compatibility transaction as other definition updates.

## Local owner MCP access

Local MCP requires the owner's one-hour MCP session and acts as the current
network owner. The session is proven by the owner's logged-in apes CLI, a phone
confirmation through the IdP QR channel, or the browser sign-in with the app's
confirmation dialog; the tool user polls the always-allowed `session` action while
the owner confirms (see `apps/openape-pods/docs/claude-code.md`). The session is the owner's own DDISA login (owner decision October
10, 2026, superseding the October 9 rule that approvals stay at the IdP): it may
decide grants with the owner's identity, see [Sandbox and grants](#sandbox-and-grants). The `networks` action accepts every network command the
desktop uses except workflow conversion and composition replacement
(`conversionPreview`, `convert`, `replacementSetup`, `replacementPreview`,
`replaceComposition`), which leave with the workflow model. It runs them through
the same worker entry point as the desktop window: create (with the reviewed
setup fingerprint), activate, pause, archive, preview/process, member script
updates, recovery (`inspect`, `retry`, `reconcileEffect`, `resolveConflict`,
`discardFailure`, `discardFeedback`) and owner routing (`choose`, `gateReview`,
`gateDiscard`). `gateOpen` opens the IdP approval page in the owner's browser
through the desktop producer; an item grant of such a batch can also be decided
with `grants` `approve` or `deny` in the session. The `desktop` action forwards the
dialog-free desktop `definitions`, `scheduling` and `workspace` commands to the
producers of the desktop window.
Reads reuse existing bounded views (2 MiB total); explicit network reads filter
other network summaries, gates and choices. Secret values and approval URLs are
not returned.

Network mutation receipts bind a stable request UUID to canonical arguments and
owner identity in the existing action journal. An exact retry returns the original
receipt; an interrupted/failed request requires inspection. Preview expiry,
paused-member acknowledgement, resource/definition fingerprints, process budget,
execution grants and restart recovery still apply. Fresh approval skips individual
inputs with applied or uncertain effects or an uninspected attempt; they stay in
their superseded batch for review. Network members accept ordinary Pod actions;
the shared engine still refuses their direct runs and Pod schedules, and a member
whose active script no longer matches its pin blocks network activation and
processing until it matches again. Unrelated Pods remain available.

A centrally serialized local owner start carries trusted operation context from
the main process. The closed automatic scheduler gate does not reject that one
explicit run, and no unrelated scheduler domain advances under its authority.
Startup, suspend, maintenance, global concurrency, membership and grant checks
remain required. Client-supplied authority fields are rejected.

## Sandbox and grants

Owner decisions October 10, 2026 (issue 1455, M6d). The sandbox decides what a
Pod can execute and reach: assigned applications as whole programs, HTTPS origins
with methods, folders, secrets and the level `isolated` or `owner`. Grants decide
what it may do. They are independent; a call needs a sandbox entry and a covering
grant. `owner` gives the Pod's programs the owner's file and network reach (a
permissive profile under the same supervising helper); it is about paths and
reach only, and the Pod's DDISA identity stays the Pod.

Every grant is requested by the Pod identity and recorded in the worker's
`pod_grants` ledger with its authorization details, state, origin and whether it
was approved in an owner session. A call is matched to the newest recorded grant
whose details cover it (`cliAuthorizationDetailsCover`); the IdP reading of that
grant must cover it as well, and so must the minted token
(`authorizeAssignedCommand` checks coverage and refuses `_generic.exec`). A
whole-program grant has one detail per action and first resource without
selector; groups that contain an adapter operation marked `exact_command` are
left out. An origin grant without methods covers every method.

A network-level declaration (`sandbox` or `grants` with target `{networkId,
revision}`) is fanned out to every member of that revision: one request per
member Pod, recorded with the network id and revision as origin, and the sandbox
entries it added recorded in `network_sandbox_resources`; the network's level is a
`pod_sandbox` row with source `network:<id>`. A member therefore has the network
sandbox plus its own. Archiving the network deletes its level rows in the archive
transaction; the desktop then revokes, as each member Pod, the grants with that
origin and removes the sandbox resources it added. A grant keeps the origin of its
first record, so a network never adopts a member's own grant.

The MCP owner session keeps the owner's tokens only in main-process memory and
renews the five-minute access token there, never past the session's hard end;
ending the session revokes its refresh token. `grants` `approve` and `deny` are
the only decision path: they refuse without an active session, read the grant
with the owner's token and require that a Pod of this owner requested it for
itself (requester, `pods:<podId>` target and broker binding) before calling the
IdP with the owner bearer. The persisted setup login is never used for it. The
conveniences `grants` `request` and `sandbox` `apply` request each grant as the
Pod and approve it as `always` in the same call (no IdP standing-grant policy, no
protocol change); without a session they only request and return the IdP pages.

A run that executed an application command whose adapter action is not `read`,
`list` or `get`, or an HTTP write, is never replayed automatically: application
writes are recorded in the effect ledger as `program.call` effects, and a failed
run with any effect goes to owner review; an interrupted or failed application
write stays `unknown` until `resolveHttp` reconciles it, like an unknown HTTP
delivery.

## Mail archive port

The first external action port (issue 1454). A consumer whose every subscribed
input is the output of an approve gate and that holds exactly one assigned mail
application (`tool.app_*`) is the archive member; neither its script nor its agent
can invoke that application directly.
`context.network.archive({application, mailbox})` processes the invocation's gate
coverage: per approved item it resolves the message id and version from the case
`source_mapping`, computes the logical action key
`[ownerIssuer, ownerSubject, podId, caseId, 'mail.archive', messageId, sourceVersion]`,
returns `archived` without any provider call when the key is already
`confirmed_applied`, and otherwise records `intent` before any provider call.
It re-reads the message (granted `workflow read`), records `confirmed_not_applied`
when the message is gone or its content version changed, and only then runs the
granted `workflow move ... --destination archive` with the current changeKey and
folder through the separate `mailMove` broker service, which accepts exactly that
argv and the adapter action `move`. A bound receipt (before/after id, changed
folder, request id) records `confirmed_applied`; a provider refusal records
`confirmed_not_applied`; anything after dispatch without a bound receipt records
`unknown`. Each item's outcome is returned to the script, so one uncertain move
never fails the script. When the script completes and no effect is still in
`intent`, settlement completes the run, marks every other input `done` and holds
back only the inputs whose effect is `unknown` (delivery state `unknown`, listed as
an `uncertain` failure in network detail). `reconcileEffect` on such a completed
run records the owner-confirmed outcome without process inspection and marks the
held input `done`. A failed or stopped script, or an effect still in `intent`,
remains a run-level failure that blocks its member until recovery. A held unknown
effect does not block the member, but two unresolved unknown effects of one member
stop its admission and gate maintenance ("Network member stopped after repeated
unknown external outcomes") until they are reconciled. The port also reports a
message as `skipped`, without any provider call, while any earlier attempt of any
version of that message in the same mailbox (case-insensitive) is unresolved, in
any network. Microsoft Graph
offers no atomic conditional move, so this port is the owner-confirmed operation
`docs/workflows.md` requires: every move is bound to one owner once-grant and to a
fresh read immediately before it.

