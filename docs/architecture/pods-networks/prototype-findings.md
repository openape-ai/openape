# M1 transaction and volume evidence

This increment is an isolated SQLite prototype in the existing Pods scheduling
suite. It does not add a production schema, activate a network or migrate owner
state. M2–M14 product acceptance remains open. Native issue:
https://repos.openape.ai/patrick/monorepo/issues/1417.

## Verified transaction decisions

- Accept the source identity, event, fan-out and checkpoint in one transaction.
  Actual child-process SIGKILL inside acceptance leaves none of those writes;
  SIGKILL after acceptance preserves all of them.
- Reserve each instance independently. An expired callback loses its token while
  its instance stays reserved. Release only after termination is observed;
  startup recovery selects prior boots and preserves healthy same-boot work.
  The prototype trusts its test coordinator's termination assertion. M4 must
  use the actual process manager's exit observation before reassigning work.
- Fence commit and effect begin by invocation token, boot, restore incarnation,
  activation epoch, membership, delivery owner and generation.
- Commit record revisions, derived emissions, input acknowledgement, checkpoint
  and invocation finish atomically. An optimistic conflict rolls back the entire
  batch. This demonstrates a logical optimistic-revision conflict, not concurrent
  SQLite writers: the prototype uses one synchronous connection. Keep the planned
  per-record CAS; actual writer contention must be measured in M3/M4.
  Join comparison here is limited to the frozen design: explicit expected branches
  per case/revision, versus the existing whole-run producer barrier. Join execution
  and mixed-case contention remain unmeasured until M7; do not infer them from CAS.
  M1 step 4 therefore establishes only a design comparison and logical CAS proof;
  its concurrent-writer/implemented-join measurements are explicitly deferred
  to M3/M4/M7, not completed here.
- Declare each emission's causal input subset. Delivery batching does not become
  a business identity. Mixed-case and immutable workflow-version validation
  belongs to M3/M7; this prototype is not that runtime boundary.
- An open effect intent prevents settlement. Process death retains its delivery
  and append-only evidence as unknown. A confirmed receipt suppresses repeat
  issue after actual SIGKILL. A new numbered attempt requires an explicit
  negative reconciliation; changed input under a completed key is refused.
  Test-local reconciliation booleans are not a production authorization API.
- Snapshot restoration creates fresh nonces, pauses intake, revokes leases and
  retains unresolved work/unknown effects. This proves the isolated SQL design;
  M2 must extend the actual encrypted archive and restore pipeline, and M5 must
  independently bind approval manifests to the restored incarnation.
- Retain identity receipts after completed trace pruning. Unresolved deliveries
  remain; repeating an old source item cannot recreate consumer work.

The retained crash/authority tests exercise the actual file-backed PodDatabase,
SQLite transactions and process termination. They protect consequential design
contracts while implementation proceeds. In M3/M4, port their assertions onto
actual network execution and remove the duplicate test-only implementation.
They must never be reported as completed product runtime acceptance.

## Volume fixture and interpretation

Three networks each accept ten 500-item batches. Each item fans out to three
independent five-stage branches, plus held-approval and failed-consumer queues.
One completed branch writes two revisions per source case. Maximum fixture
payloads remain below the 1,024-byte envelope payload ceiling. Both stopped
queues are marked blocked after every batch; real gate orchestration is M5.

Queue/lease isolation is directly checked across two networks with one unresolved
consumer. Global slot saturation and actual held-gate fairness remain M4/M5
acceptance; the prototype has no shared-slot scheduler.

This produces 195,000 events/identity receipts, 255,000 deliveries, 15,000 records
and 30,000 record revisions. Reference-aware trace pruning leaves 15,000 source
events and 30,000 unresolved deliveries, retaining all 195,000 identity receipts.

Measurements record Node/SQLite/platform, WAL and table/index bytes, p50/p95,
projection size, a noisy worker RSS delta and compacted snapshot bytes. Acceptance
samples are 500 items with five subscribers; settlement samples are 50 items
with up to 50 emissions or 100 writes. Queue acquisition excludes empty probes.
It is not production ready-to-dispatch latency, fair rotation or global-slot
contention. Local summary serialization is not authenticated relay publication.
Power-loss durability, macOS fullfsync and artifact quotas are not claimed.

Initial small-payload measurements exposed a 577 ms p95 full-scan overview despite
an 856-byte response. Transactional queue-count projections reduced that local
summary to approximately 0.015 ms p95. Counts are updated in the same SQLite
transactions as insert, state transition and prune; rollback cannot drift them.
M2 must preserve this separation between authoritative queues and projections.
The isolated prototype uses triggers. The existing production backup validator
rejects SQLite views/triggers; M2 must maintain production counters in the runtime
transaction and retain that default rejection. This snapshot is not an encrypted
archive round-trip and does not claim backup-validator compatibility.

The actual maximum-payload rerun at
`26684ec0986d1e3d119ba54cb0ca6c1b25139065` measured
450,252,800 allocated database bytes and a 96,526,336-byte compacted snapshot after
retention. The existing backup uses VACUUM INTO before its 256 MiB database check;
raw high-water size is not the archive limit. That exact commit passed root lint/typecheck, Pods build and six focused
suites (123 tests, including the 24 retained contracts and temporary volume).
[Native PR 201](https://repos.openape.ai/patrick/monorepo/pulls/201) records the
commands and final-head unit receipt. The final commit removes only the temporary
volume fixture; its test source and measured results remain in PR history.
The 5,000-ready-backlog probe after retention measured 11.08 ms p95 across
100 free-slot claims. Its sorting by event acceptance cannot use the prototype
ready index directly; M2 should denormalize accepted/ready ordering into the
subscription-leading index from the frozen inventory. This is not a scheduler gate.

The exact committed run measured local settlement p95 23.91 ms, free-slot
acquisition p95 2.55 ms, and a 346-byte local overview at p95 0.0177 ms.

## Numerical defaults and dependent acceptance

- Keep the local 50-item settlement target below 100 ms p95. The prototype meets
  it; M3/M4 must remeasure real runtime execution and scheduler latency.
- Retain the existing 1–8 global slots. Start the per-network limit at the global
  limit with fair rotation in M4; serial queue timings do not justify a lower
  hard-coded network cap. Measure 1/2/4/8-slot production fairness in M4.
- Use a 192 MiB authoritative database admission target, leaving 64 MiB below the
  existing 256 MiB compacted-backup ceiling. Apply retention before admission;
  pause/refuse intake without advancing the source checkpoint when unresolved
  state and retained markers cannot fit. Check the whole profile and index costs,
  not just new network payloads. Per-network budgets divide the remaining owner
  budget; never automatically discard unresolved work or shorten dedup horizons.
- The fixture's identity table/index consumes about 60.5 MB (57.7 MiB), about
  310 bytes per receipt. The 192 MiB budget could fit roughly 650,000 such receipts
  if nothing else used space; actual capacity is lower because events, records,
  indexes and legacy state share it. Of 195,000 receipts, 15,000 are source and
  180,000 derived. At this full workload daily, source-only 90-day retention is
  roughly 0.42 GB; retaining every namespace for 90 days is a conservative
  approximately 5.4 GB estimate, not the source-only contract requirement.
  The prototype retains every receipt. Keep derived/replay receipts until causal
  inputs, checkpoints and replay horizons cannot recreate them; M4 must prove
  reference-aware compaction or a reviewed watermark before removing receipts.
  Trace pruning alone never proves that. Intake pauses before saturation; no
  unlimited sustained-volume or shorter source-horizon promise is made.
  Even source-only receipts at this daily rate would fill the entire 192 MiB
  budget in about 43 days (at most roughly 7,200 source items/day over 90 days);
  all-namespace retention reaches it in about 3.3 days. Other retained data lowers
  those limits. M2 must store causal-reference/watermark metadata before M4
  can prove safe compaction. No automatic source-horizon reduction is allowed.
- Local queue overview bytes stay independent of event count. Stable-key detail
  pagination, actual relay publication time and old/new protocol negotiation
  remain explicitly unmeasured until M10. The 32 MiB workspace gate must be
  exercised against the whole real projection there.
- New collection revisions/artifacts have explicit retention and quotas in M6;
  no synthetic artifact or memory-ceiling measurement is claimed here.

The volume fixture is temporary. Preserve its tested commit and measurements in
PR history, then remove it in the final commit. Final-head automatic CI runs the
unit contract only and does not execute that removed fixture.
