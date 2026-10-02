# Portable Pods: package boundary and implementation inventory

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
with source CI5351/main CI5352 green. M2 continues from that merge on
`feature/issue-1419-sharing-export`; final acceptance remains pending.

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
alias, recipient agent identity and issuer inputs, Jev
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
