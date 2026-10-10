# Portable Pods: package boundary and implementation inventory

> Historical design record of issue 1419 and its milestones. Sections on
> workflows, sequences, bounded graphs, conversion, earlier gate formats, change review,
> access proposals and network-only limits describe removed behavior (issue 1455).
> The current model: [Pods model](../../apps/openape-pods/docs/model.md) and
> [networks](../../apps/openape-pods/docs/networks.md).

Approved plans: [sharing](https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M3NA5X47W7HAV5SE10D0EN1G)
and [networks M11](https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M3VDB1S72E4EQQW58T97C617).
Implementation: [issue 1419](https://repos.openape.ai/patrick/monorepo/issues/1419),
linked to [issue 1417](https://repos.openape.ai/patrick/monorepo/issues/1417).

Baseline: canonical `667745cbcbb751349c4f83714f4847966e5c04c9`, full-main CI 5346.
Dedicated checkout `openape-monorepo.worktrees/pods-portable-sharing`, branch
`feature/issue-1419-pod-workflow-sharing`. Schema 33 is current. Frozen install and
prescribed prebuild completed; Doctor passes. No user database is opened or migrated
by the manifest code. M0 was accepted in PR215, merged as
`04c20aa8df50bd6e85bca99aa520e355d727c3f4` with source CI5347/main CI5348 green.
M1 was accepted in PR216, merged as `6133326303b9d1cf46fd843451f00b918849c6e1`
with source CI5351/main CI5352 green. M2 was accepted in PR217, merged as
`eb53ed76433280ac20d286f3669d9bb23184debe` with source CI5353/main CI5354 green.
The first M3 increment was merged in PR218 as
`d564a51212091564aa90d8fa96f19bdb438b0294` with source CI5355/main CI5356 green.
The second increment was merged in PR219 as
`1bb1cccaef753b2c4f212897762283bb60fcb0ab` with source CI5357/main CI5358 green. The third increment was merged in PR220 as
`1317b2d75bfa492f76f106069d90363812e51fa8` with source CI5359/main CI5360 green. M3
continues on `feature/issue-1419-sharing-networks`; schema 34 adds the local import
journal and schema 35 persisted resource aliases.

## Manifest v1

`packages/pods-protocol/src/sharing.ts` is Node-free. The closed manifest describes
package identity/revision, an entry, required runtime features, Pods, compositions,
application requirements and a file inventory. All references use package-local
keys; keys are not sender UUIDs. A package revision is content provenance, never an
instance binding revision or a grant. A content digest is integrity, not authorship
or code safety.

The package contains exactly one `manifest.json` plus at most 499 listed files.
Transfer is at most 25 MiB, total expansion including the manifest 100 MiB, manifest 1 MiB,
and 32 Pods. File roles have separate limits: scripts 800000 UTF-8 bytes (native
source validation additionally enforces 200000 characters), package manifests 16 KiB,
locks 1 MiB, assets 32 MiB, composition documents 1 MiB and data schemas 16 KiB. Streamed
archive decoding must enforce actual output before extraction; manifest lengths
are untrusted until compared with actual bytes. ZIP links, executable assets,
unsupported compression/encryption and unlisted/duplicate entries must be refused.
Only Pod script entries are executable source, and import never evaluates them.

Paths are ASCII relative paths with no traversal, Windows device names, trailing
periods, case collisions or file/directory collisions. `manifest.json` is reserved
case-insensitively. Every listed file has a role, byte count, SHA256 and media type;
every file must be referenced. No history, cache, home or credential role exists.

`portableContentBytes` serializes sorted object keys and path-sorted file metadata,
excluding only `contentSha256`. Array order outside the file inventory is preserved.
`portableContentBytes` requires the real supported feature set as its second
argument and reparses before hashing. Hash these bytes with SHA256. Each file's exact bytes and the final ZIP archive have
separate SHA256 digests. ZIP verification, digest comparison and durable staging
remain app work; the manifest parser does not claim to perform them.

Inputs declare type, required state, label, description and an optional explicit
sharing group. Same names never imply sharing. Resource and secret inputs have no
default field; ordinary defaults are opt-in. Pod strings retain the native 2048-char
limit, graph values 16384, other composition public values 1024. Explicitly shared
inputs must have identical types, bounds, choices, defaults and required state.
Application aliases are scoped to a Pod; each points to a separate account input.
Even when requirements match, no account state is implicitly shared. Adapter and
application identity/version metadata are declarations, not verified local matches.
An `official-url` declaration is untrusted publisher text until an existing trusted
application catalog confirms it; it cannot authorize a fetch, installation or probe.

Composition indices carry complete membership, sequence predecessor/handoff edges,
call targets, input declarations and references to versioned composition documents
and data schemas. Mail policy inputs encode JSON arrays validated by the native
mail configuration parser after recipient binding; no policy is executed at import. All members must be reachable from the entry, calls target packaged
finite workflows (sequences or bounded channel graphs), call cycles are refused, and one mutable Pod cannot belong to two
compositions. Channel/network compositions have no sequence edges. The document
must exactly agree with the index; this is a second validation boundary, not an
unchecked extension field. The app must validate domain payloads, run graph/network
diagnostics and compare contracts with locally validated scripts before staging or
activation. Documents must omit local IDs, authority pins and runtime state. Their
closed alias-based schema is validated in `contracts/portable-composition.ts` using
the existing native graph, network, schedule, collection and workflow-port parsers.
Synthetic UUIDs exist only inside pure validation; the returned documents retain
aliases. Native graph entry/terminal checks are shared with published revisions.
Recipient resource-dependent diagnostics (including archive gates) still run after
actual binding; requested capabilities alone cannot establish those facts.

Requested access is explicit: directory input plus `read`/`readWrite`, HTTP origin
input plus methods and an optional DDISA agent declaration referencing a secret
alias, recipient agent identity and issuer inputs (plus `exchange: "sp"` when the
destination accepts only its own exchanged tokens), Jev
connection/model inputs plus a bounded attempt count, or read-only mail scope with
a recipient connection, selected folders, start-date input and attachment choice.
Mail folder IDs have no sender default; their input encodes recipient-selected
folder objects as JSON. Empty start-date text means all history. Mail setup remains
unresolved wherever the current runtime has no supported recipient assignment path. These are declarations, not
resource assignments. The sender's agent identity and credential values stay local;
resolved origins, pinned Jev models and actual permissions must pass their native
validators before setup can complete. SSH inventory profiles are currently local
and unsupported for portable export; refuse them explicitly instead of omitting
or broadening their restrictions. Assets remain separately selected files.

## Reviewed source export (M2)

The worker captures selected current scripts, validations, resource epochs, public
configuration and complete composition membership in one database transaction.
Immutable call revisions must still match their owned, same-company members.
Unadopted local Pods follow the existing authenticated owner-profile rule from
`DefinitionCatalog`; known remote/definition ownership is checked without adopting
or changing the source. Data ownership also follows the existing composite foreign
keys. No execution history, private home, account state, credential value, record,
artifact content, decision or effect receipt is read into an export.

`PortableExporter` keeps at most eight owner-scoped, ten-minute review sessions
and permits one preparation at a time per instance. Routes must bind that instance
to the authenticated owner. Privacy scanning yields between checks.
It freezes the choices, validates the complete package and returns its exact
manifest plus redacted findings. Commit recaptures the source, rechecks installed
dependency bytes and stored lock agreement, rereads selected static references and
compares the fingerprint, archive digest and findings. Expiry, cancellation, source
changes and changed file bytes refuse the download. Repeated unchanged downloads
are intentionally idempotent. Runtime cursors and pause state do not invalidate a
review, while relevant source revisions do. Export reviews are ephemeral; durable
import recovery belongs to M3.

The generated validation trailer is special metadata: the exporter reconstructs
the exact terminal `Pods binding` comment from the verified stored manifest and
removes only that matching suffix. It otherwise preserves script bytes, including
user comments and hard-coded IDs. This avoids exporting local capability IDs added
by the validator itself. Original stored scripts are never changed. Recipient
validation must generate fresh binding metadata. A definition-pinned script can
retain a publisher trailer whose revision differs; that unmatched suffix is
preserved. Definition publication already refuses instance-specific tool identities.

Source inventory exposed gaps in the preliminary, not-yet-shipped v1 contract.
M2 corrects them before the first exporter is released: collections carry their
script-facing names and retention declarations; artifact scopes retain explicit
collection relationships; converted-network variable projection is declared;
HTTP authentication uses the actual secret/subject/issuer model; standalone Pods
can carry a suggested schedule. These changes transfer no runtime authority.
Member Pod schedules are omitted and refused for composition entries to avoid
competing schedule declarations. Schedules and mail policy mode describe requested behavior only. M3/M4 must leave
schedules disabled and require independent access, script, schedule and first-run
approval, including a review of timezone and any one-time date. Archive mode never
authorizes a mail action merely through import.

Shared configuration is grouped only from explicit source composition bindings.
Its default is selected once on the composition and reused by those members;
instance overrides remain separate recipient inputs. Same-named fields or accounts
do not create a sharing group. Directory, connection, secret and HTTP subject
inputs cannot be shared. Access inputs are independent of script variables,
application environment inputs and other access roles. Explicit application-account groups remain supported
under the existing matching-application contract. CLI version constraints remain empty without a
verified test; a bundle's static version declaration is not evidence of a tested
application version. Custom runtimes, entry files, cache arguments, application
network hosts and SSH profiles currently refuse export with an explanation rather
than dropping their requirements.

Every reference requires an explicit include or omission choice. Included files
use package-local `assets/…` paths, which are their portable reference aliases in
the M3 runtime view. Capture rejects symbolic/hard links, private workspace storage,
changed files, executable source names/magic and role-size violations. UTF-8 and
recognizable UTF-16 text are scanned for known source identities/paths and likely
credentials; known unselected private values in scripts/assets require review.
Nested mail/configuration strings are included. Known-value checks use word
boundaries and one finding per file/value; generated locks/composition documents
are excluded from that heuristic to avoid common words exhausting the limit.
Machine-reference and credential-pattern scans still cover every payload. Opaque containers and
binary files explicitly require acknowledgement of the scan limitation. A heuristic
scan cannot guarantee that arbitrary source or assets contain no private data.
Selected public defaults suppress known-value findings only in the manifest,
never in scripts or assets. Paths and owner subjects are matched case-sensitively;
UUIDs are case-insensitive. Null/object public configuration refuses export.
HTML/SVG assets are inert documents: import and preview must never dispatch
execution based on their filename or sender-supplied media type. Retention is an
opaque declaration; no importer may interpret it without a native policy parser.
Known machine bindings/private keys block export; findings never contain the
matched value or its hash. Asynchronous fflate compression creates deterministic
archives with bounded content and transfer sizes.

`portable_aliases_v1` remains a required importer feature, not an advertised
runtime capability. File validation requires the caller
to supply its actual supported features; the exporter set is named separately.
Package Pod keys, asset paths and composition keys define the
future handoff/reference/call aliases; M3 must map them to fresh local identities
and immutable call revisions while retaining legacy UUID behavior. M2 proves inert
package structure, not recipient execution or UI delivery. Real desktop/browser
routes, encrypted transfer and independent approvals are M4 acceptance work.

## Journaled paused import (M3)

`worker/sharing/archive.ts` decodes an untrusted archive completely in memory before
anything is stored. It accepts exactly the exporter's ZIP subset: one volume, no
comment, no leading, trailing or unlisted bytes, contiguous local entries that agree
with the central directory, stored or deflated regular files and no flags, extension
fields, comments, data descriptors, ZIP64, encryption, links or directories. Declared sizes bound inflation, consumed
input must equal the compressed length, CRC and manifest hashes must match, and
`manifest.json` must be the canonical serialization. A hand-repacked archive is
refused; the reviewed export is the only supported producer.

Schema 34 adds `portable_imports` and `portable_import_pods`. Both are local-only:
they are not central tables and never enter relay publication or operation logs.
`PortableImporter` is bound to one owner; at most eight imports may hold an archive
at once:

- `inspect` validates and returns the manifest without storing anything.
- `stage` is idempotent per request key. It stores the exact archive as a blob that
  retention keeps while the journal references it, and records one fresh Pod ID per
  package Pod. A reused key with different bytes or another owner is refused.
- `configure` accepts declared public scalar inputs at the current journal revision.
  A value entered for one member of an explicit sharing group applies to that group.
  Directory, account, connection and secret inputs are never values; they are bound
  through later setup steps and secrets go to the credential service.
- `commit` rereads the stored archive, writes import-owned asset copies into each
  fresh Pod workspace and then, in one transaction, creates the paused Pods with an
  inactive draft, native string variables and asset references named by their
  package path. It writes no script version, validation, schedule, identity, grant or
  composition. Tool capabilities are added only when the recipient binds resources.
  A repeated commit returns the existing copy.
- `complete` requires that nothing is unresolved, then releases the archive. Until
  then ordinary dependency preparation, draft validation, example installation and
  script activation are refused for these Pods, so imported source cannot run and its
  dependencies cannot be resolved afresh during setup. A deleted Pod no longer blocks
  the setup of its siblings.
- `cancel` discards a pending import only. Once the paused copy exists its Pods are
  ordinary owner Pods: the owner archives and deletes them individually through the
  existing reviewed path, and the journal is forgotten when none remain. Import
  never deletes a Pod, account or credential.

A refused or raced commit removes the files it wrote; startup recovery removes those
of an interrupted one. An interruption therefore leaves either a pending import or
one complete paused copy. A cancelled request key may be reused after its journal is
forgotten. The pre-upgrade database copy is private, reopened and checked before
migrating. Backups do not contain package archives: restore cancels staged imports,
marks committed ones for a fresh import of the file and moves references into the
profile's own Pod storage to the restored location. Imported assets live in that
private storage, which the exporter refuses as an asset source; re-sharing them
requires an owner-selected copy outside it. Blob retention now reads references and
removes unreferenced blobs without yielding in between.

### Aliases, binding and setup state

Scripts never address tools by capability identifier: HTTP requests match an approved
origin, application calls use the assigned application name, and folders and files
are paths. Schema 35 therefore stores portable aliases for current file, directory
and tool assignments in the local-only `resource_aliases` table (one assignment may
serve several aliases), and a run receives `context.aliases` with `applications`,
`http`, `directories` and `references` maps for its ready aliased assignments. The
maps are empty without aliases, grant no access and leave existing scripts unchanged.
Setting an alias advances the resource epoch like any assignment change. Imported
assets are aliased by their package path.

After the paused copy exists the recipient assigns folders, HTTP tools, applications
and secrets through the existing owner-approved resource operations of each Pod.
`bind` then records which assignment serves a declared directory, HTTP or application
alias after checking it against the declaration: access mode; origin, at least the
declared methods and the exact agent identity; application identity and declared
environment values. A bundle's identity and executable hash are read from the
assigned bundle by the main process, never taken from the caller; the worker compares
the hash with the assignment it binds and keeps it, so a later change of that
assignment reopens setup. Only a tool capability the package requested
for that alias is named in the imported draft; a draft the owner replaced is left
alone. Secrets match by credential alias, Jev by its single native assignment
with the declared model and at most the declared attempts, and mail by the single
`mail.read` assignment with the declared attachment choice, start date and the
recipient's folder selection. Because a reassignment creates a new local resource, `bind` remains
available after setup.

Setup state is derived from actual local state: a revoked or changed assignment
reopens its requirement, and a variable input counts as resolved when the Pod has
a variable that is a valid value of its declaration, wherever the owner set it.
Declared access and environment values use that Pod variable when the same input is
also a variable. Access inputs such as an origin or agent
identity stay editable in the journal during setup; variable inputs become Pod
variables at commit and are edited there. `prepareDependencies` installs exactly the
imported lock recorded at commit; without the archive (after a restore) the package
must be imported again, which also applies to an unfinished composition.
`complete` requires every requirement.

### Composition finalization

`finalize` creates imported compositions from their package documents. Sequences
and channel graphs without ports or mail policy are created disabled during setup:
member keys become the fresh local Pods, declared graph values take the recipient's
composition inputs, a channel graph joins a group the recipient chooses (its member
Pods are placed in that group; a Pod of another group is refused), and the suggested
schedule is stored while the workflow stays disabled. This needs no script approval
because a member without its own approved script cannot be started by a workflow
run. A repeated request returns the existing workflow; an archived one reopens the
requirement during setup, and a composition that lost a member Pod (deleted or
archived) is no longer required. When a Pod and all its handoff predecessors came
from the same import, its script additionally receives
`context.input.workflow.outputsByKey`, the predecessor outputs under their package
Pod keys; the UUID-keyed view is unchanged.

Persistent networks, called workflows with ports and mail policies are deferred:
staging records them, `complete` does not wait for them and keeps the archive, and
they are created after Pod setup once every member script is validated and active
(`worker/sharing/compositions.ts`):

- Each network member is published as its own definition with typed defaults from
  its scalar bindings and bound to that published version, so shared network values
  resolve against declared public fields. Pod variables created at commit stay as
  the separate `context.variables` namespace; the exporter keeps both alias sets
  distinct.
- Members must still be fresh instances (no network or workflow membership, run or
  schedule history); group membership, binding moves, network creation, data access,
  calls and the journal record happen in one transaction after publication. The
  network is created paused through `NetworkEngine` with the recipient's group, the
  document channels, gates and joins and shared values from composition inputs. The
  native setup fingerprint cannot exist for fresh Pods that join their group and
  binding only here; the import review of the declared members, channels, values and
  access is the owner's reviewed setup. The connected-workspace creation guard
  applies unchanged. Activation stays a separate owner step.
- Declared collections are new owner records in the recipient's group with their
  schema version, retention and per-member data permissions. A collection whose name
  already exists in that group is refused unless the recipient explicitly reuses it
  and its current schema and indexes are identical. Artifact scopes and their
  permissions are created likewise; a scope without a collection is private to the
  new network. No records, artifact bytes or grants are transported.
- Called workflows are created first in the caller's group with approved members
  (disabled, no ports), then published as an immutable revision from the document
  ports, and the calling network members receive enabled call permissions. A call is
  only granted to a workflow of the network's group whose members belong to it,
  because the runtime refuses any other call.
- A mail policy maps to the native configuration from the bound filter application
  alias, the fresh member Pods and the recipient's string inputs.

Staging still runs the native workflow parser over each plain composition. A
completed import with pending deferred compositions stays listed and holds its
archive; it is released once the last one exists or became impossible, or when the
owner cancels the import, which then only abandons what was not created. A restored
profile requires a fresh import for unfinished compositions. A
Pod that already took part in a workflow run follows the existing retention rule
for workflow history when the owner deletes it.

The worker entry accepts the closed `portableImport` command set only after desktop
identity setup; dependency preparation runs under the maintenance gate. The main
process routes commands and, in a connected workspace, records a pending identity
for every created Pod through the existing provisioning path, so one failure does
not leave later Pods without a retry. No renderer, preload
or relay route exists yet.

Still open for M3: workflow call alias views for network scripts, exporter defaults
from stored aliases and keys, and native acceptance of the deferred paths (mail
policies, Jev and mail assignments, real dependency installation). The complete desktop and
browser flow is M4.

## Desktop and browser flow (M4)

One validated `sharing` command set serves both surfaces. The renderer bridge, the
IPC handler and the worker entry each parse it; the renderer never supplies package
bytes. On the desktop, `Open package…` runs a native open dialog in the main process,
which checks for a regular file within the transfer limit, reads it once and stages
it under a fresh request key; `Save package…` writes the reviewed archive privately
next to the chosen target and moves it into place. Sharing is available from a Pod,
from a workflow and from a network; the export review shows the exact files, lets
the owner include or omit each reference, name aliases, choose public defaults and
acknowledge every privacy finding, and releases the review when it is saved or left.

The import page lists imports with their state, lets the owner enter declared values
(variable inputs only until the paused copy exists, afterwards they live on the Pod),
bind declared folders, destinations and applications to the Pod's own assignments,
prepare dependencies, create compositions in a chosen company and finish setup. The
view's `deferred` keys tell both surfaces which compositions wait for approved
members, so the UI never guesses. Abandoning remaining compositions requires a second
explicit step. After an error the page reloads the journal so a copy created before a
failed provisioning is shown as it is.

A browser imports through the connected desktop over the `sharing` central channel
(list, show, configure, commit, complete, cancel, bind, prepareDependencies, finalize)
and sees that file transfer stays on the desktop; export is desktop-only. Component
tests cover both surfaces with a fake command API; the real-browser layout test
renders the import setup and the export review at 1280 and 390 px in both languages
and captures screenshots. Handbook sections exist in DE and EN. Native acceptance of
the complete flow on an installed app and a deployed relay is M13 work.

## Verified source inventory and required handling

| Source | Local references / behavior | Portable handling |
| --- | --- | --- |
| `contracts/resources.ts`, `worker/resources/registry.ts` | Resource/Pod IDs, path/device/inode, credentials, AI/HTTP/SSH bindings; variables are strings | Explicit typed recipient inputs; fresh resource IDs/revisions. Credentials stay in the credential service. Native string projection preserves legacy scripts. |
| `contracts/programs.ts`, `main/programs/definition.ts`, `manager.ts`, `state.ts` | Executable/adapter/runtime paths and hashes, environment, private `stateId`, grants; current discovery is name/path based | Stable requirement declarations plus trusted local byte/adapter checks; missing verified version metadata stays unresolved. New state per account binding. No imported probes/install commands. |
| `worker/dependencies/install.ts`, `tree.ts`, `store.ts` | Exact root versions; locally generated lock before npm ci; package tree hash differs from runtime `dependencyLockHash` | Carry exact manifest/lock files with their own hashes. Add strict imported-lock validation before invoking npm. Preserve registry proxy, sandbox, disabled lifecycle scripts, limits and verified immutable package tree. Never replace the imported transitive tree by a new resolution. |
| `worker/workspace/scripts.ts`, `definition-catalog.ts` | Script blobs, drafts, capabilities, assignment revision, validation evidence and active hash | Export selected immutable source after stale review; imported source becomes an inactive local draft and requires fresh validation/approval. No evidence or authority import. |
| `worker/workflows/handoff.ts` | Predecessor outputs indexed by local Pod UUID | Add a versioned portable alias output view while preserving UUID-keyed legacy output. Known embedded UUIDs require author migration; do not rewrite arbitrary source text. |
| `contracts/mail-workflow.ts` | Mailbox, filter/notify Pod IDs, application ID, Telegram alias/destination, protected partners and rule literals | Explicit alias mapping and recipient input declarations; policies/defaults require export review. Unsupported mappings refuse export. No batch, decision, receipt or account state travels. |
| `contracts/graphs.ts`, `workflows.ts`, `workflow-ports.ts` | UUID nodes and port targets; channels/gates/value names; schedule/timezone and finite completion policy | Alias nodes/port targets; preserve channels, schema versions, gates, joins and completion declarations. Suggested schedules only; imported schedules disabled. Run existing diagnostics after mapping. |
| `worker/workflows/calls.ts`, `revisions.ts` | Workflow UUID/revision in script requests; grants/pins on exact local revisions | Explicit call alias bindings to freshly published recipient revisions, with new rights. Package calls form an acyclic finite graph; no copied call permissions. |
| `worker/scheduling/network-config.ts`, `network-data.ts`, data/artifact/call permissions | Owner/group/name collection lookup; secret-reference UUIDs; data schemas and operations | Explicit new/existing collection decision with canonical schema equality. Never attach to existing data merely by name. Transfer declarations and requested operations only; no records, grants or private reference values. |
| `contracts/central.ts`, `main/central/controller.ts`, `worker/central/projection.ts` | Validated runtime operations, durable central snapshots, artifact references; network data is separately excluded | Introduce explicit sharing capability negotiation and bounded transfer. Local setup values/secrets must stay out of relay projections and operation logs. Existing generic command channels are insufficient. |
| `renderer/central/CentralWorkspace.vue`, `DesktopWorkspace.vue`, `GraphPanel.vue`, `utils/sharing.ts` | Shared surfaces; sharing entry points hidden | Keep hidden until complete review/import wizard routes exist. Reuse existing trust/approval actions with offline and desktop-local-pick states. |
| `worker/storage/database.ts`, backup/restore and network table classification | Schema 33, encrypted complete owner backup versus bounded public projection | Add import journal only with schema migration, backup/restore checks and explicit privacy classification. Recovery is operation-key/ownership scoped; preserve completed instances and unrelated accounts. |

## Actual review findings and disposition

Read-only Claude Code Opus 5.5 identified source-bound capabilities such as
`tool.app_<32hex>`, weak imported-lock assumptions, UUID handoffs/calls and implicit
collection-name reuse. The manifest rejects known source-bound capability forms.
The exporter must scan both hyphenated UUIDs and compact IDs in scripts/assets and
refuse known private references in every metadata/document identifier as well as
source and selected assets. Metadata format validation alone does not prove absence
of sender identity strings. A heuristic cannot prove arbitrary code contains
no private information.

`checkLock` currently checks root declarations, registry host and integrity syntax;
it is not sufficient validation for an untrusted imported lock. M1 must additionally
validate package path/name/version/tarball identity, closed metadata and reachable
transitives before npm sees the file, then retain actual post-install tree checks.
Do not resolve a replacement tree and silently call it the imported lock.

Current network validation permits only `mail.read` capability. The package envelope
can describe other requested rights for standalone/sequence Pods, but an importer
must refuse a network member that the current runtime cannot validate. Sharing does
not expand those rights. Manifest topology checks do not replace native graph
or network diagnostics, schema validation or runtime capability checks.

## Verification and delivery

Existing protocol Vitest suites own manifest fixtures; important retained tests
protect isolation, typed/default boundaries, reference completeness, canonical
hash input, path limits and finite topology. Existing program/dependency suites
own M1; component/central suites and manual native/browser/layout suites own the
later complete flow. No new test runner or automatic E2E/layout jobs.

M0 rollback removes inert contract exports only. M1–M4 must remain separately
reviewable. The file-transfer slice is required for network M11. Invitation delivery
keeps its separate plan lifecycle. No production activation, live conversion,
external action, multi-device execution or new central server is included here.
Release remains relay-first, with paired schema/desktop rollback evidence.

## M0 review disposition

Actual Opus 5.5 reviews found and prompted fixes for type confusion, account sharing,
source capability IDs, canonical traversal budgets, unsafe environment declarations,
mail ancestry and credential aliases, graph variable shadowing and unbound capability
operations. Environment declarations now follow the native runtime name restrictions,
allow public scalar settings only, and reject newline-bearing defaults/choices.
Recipient values are still validated at binding. Requested file/HTTP/AI access is
explicit and contains typed input references, never local permission records.
Unused Pod/composition inputs and empty data access declarations are refused.
Native resource-derived archive gating remains a mandatory recipient check.

The final review also closed scope-free generic directory/connection bindings,
limited application capabilities to the native `invoke` operation, and made mail
scope explicit. HTTP origins and pinned model names intentionally allow reviewed
public defaults, as required by the approved export plan; they are not resource
values or authority. `validatePortableAccessDefaults` checks these defaults using
native parsers (also for standalone Pods); binding must validate every supplied
value and actual connection role again. One mail/Jev scope per Pod matches the
unaliased native capabilities. A declaration without a requested capability may
be prepared but grants no executable access. Explicit shared public inputs still
must satisfy every consumer's native constraints. v1 retains the stricter input
size limits; a policy exceeding them is refused, never truncated. Broader policies
require a later versioned format decision.

Network shared configuration deliberately differs from graph variables: it overrides
declared public definition fields with matching scalar types. The portable validator
checks those declarations; applying the graph shadowing rule would reject valid
network configuration. Mail configuration uses distinct input roles and a bound
recipient credential alias. These differences were checked against native source
following the final Opus review rather than applying every suggestion verbatim.

## M1 dependency resolution

Imported npm locks use a deliberately restricted v3 subset: exact direct versions,
public-registry package tarballs matching package name/version, canonical SHA512,
closed metadata and reachable semver-compatible transitive edges. Registry aliases,
links, workspace/file/git sources, lifecycle hooks, development dependencies and
native payloads are unsupported. Export must call the same strict validator before
creating a package, so unsupported source locks fail visibly at the sender.
Existing local generated-lock preparation is unchanged.

Imported preparation invokes only `npm ci`, retaining the registry proxy, isolated
home, sandbox, output/storage/time limits, disabled lifecycle scripts and bin links.
The lock is checked for unexpected modification afterward. npm enforces tarball
integrity; installed package identities and all
normal/optional/peer dependency declarations must agree with the lock. Unlisted and bundled packages are refused. Mandatory
reachability is derived from edges instead of trusting optional flags. Actual
package files retain the existing immutable content hash and link/native checks.
Canonical JSON formatting can change the whole local dependency-set hash; original
package bytes and parsed lock metadata must remain equal. Existing manifest-only
lookup never silently reuses a different imported lock.

Application resolution uses owner-selected paths, known owner-assigned candidates
and the established CLI PATH lookup. It never scans arbitrary application folders,
fetches distribution URLs, executes an imported probe or installs software. Bundle
identity/version comes from static plist declarations, not verified publisher
signatures. Callers must retain that provenance and restrict candidates to existing
owner choices. The built-in launcher contract is `ai.openape.pods.launch`, version 1.
CLI identity and adapter version must exactly match a selected local adapter.
A declared CLI tested version stays `setupRequired` because there is no approved
static source for that version. An empty tested-version list explicitly yields
`testedVersion: false`, never a verified version claim.

Resolution hashes actual local executable/adapter bytes and returns software only.
Bundle preview is read-only; the binding commit materializes its local launcher with
`bundleDefinition` inside the import-owned directory and rechecks executable bytes.
Runtime descriptors are owner-local selections, loaded through the existing native
validator; portable packages cannot supply executable paths or runtime settings.
M3 must repeat resolution at commit to refresh static metadata and local selections.
The importer must call `ProgramManager.add`, never `replace`: each account binding
gets fresh private state and empty grants. `available` means software can be bound,
not permission to execute. Missing, malformed, ambiguous, untested and incompatible
candidates remain actionable setup states. No M3 importer/UI wiring is claimed by M1.

Retained tests protect authority/state isolation, lock tampering, installed-manifest
consistency and exact-lock reuse. The manual dependency E2E performs real sandboxed
public-registry preparation, imports the original lock into a second paused Pod and
rejects altered SHA512 without publishing a dependency set. This manual test does
not run in automatic unit-only CI. No UI changed in M1; screenshots are not claimed.
