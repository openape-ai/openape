# Independent Reports recovery

Reports can require an encrypted external transaction authority before acknowledging a
write. Enable it with `NUXT_REPORTS_RECOVERY_CONFIG_PATH`, an absolute path to a private
regular JSON file. The local SQLite database and policy journal remain the serving
store. A verified Restic checkpoint and the external committed transaction chain are
sufficient to reconstruct confirmed content and permissions without the original host.

This is a single-writer recovery mechanism. Fence the original process and its restart
path before recovery. Conditional writes reject competing writers, but do not stop an
old process from serving its existing database. There is no automatic failover.

## Configuration and storage permissions

The configuration contains `endpoint` (HTTPS origin), `region`, `bucket`, `prefix`,
`accessKeyId`, `secretAccessKey`, and `encryptionKey` (canonical base64, 32 random bytes).
Keep it mode 0600, readable only by the service identity. Keep independently recoverable
copies of that configuration and the Restic credentials away from the source host.
Never place these values in Git, command arguments, reports or application logs.

The service needs GET on its `head` and `records/` objects, conditional creation of
records (`If-None-Match: *`), and conditional replacement of `head` (`If-Match`). Enforce
those boundaries in provider IAM. It needs no deletion, bucket listing, IAM access or
access to the Restic backup prefix. Test permitted operations and refusals with synthetic
objects before activation. The management process separately needs Restic read access.

Records contain deterministic parameterized SQL, including immutable content, encrypted
with AES-256-GCM and linked by ciphertext digests. A write creates its immutable record,
conditionally advances the encrypted head, then commits locally. A failed or ambiguous
external/local commit fences serving with HTTP 503. A record exceeding the size limit
is rejected with HTTP 413 before storage access; it rolls back without fencing other requests. API errors use the existing problem
format with `operation`, `phase`, and a safe `cause` code. Reconcile before retrying and
reuse the original idempotency key; a lost response can follow a durable remote commit.

## Initial activation

Use the reviewed build's `.output/server/reports-recovery.mjs`. All mutating commands
require `--writers-frozen`; that flag records the operator assertion, it does not stop
processes. Stop the service including its retention worker, not only publication routes.

1. Preserve the database, current journal, environment and previous image. Verify a
   consistent backup and a recovery-capable rollback path before preparing the database.
2. Run `prepare --database file:/absolute/testrun.db --writers-frozen`. This adds the
   recovery identity and sequence zero. A prepared database refuses startup without
   recovery configuration. Disabling the option is not a rollback.
3. Capture the prepared database in the existing off-host Restic repository. Retain the
   full snapshot ID and the absolute path inside that snapshot.
4. Run `bootstrap --database file:/absolute/testrun.db --config /private/recovery.json
   --restic /absolute/restic-wrapper --snapshot FULL_ID --snapshot-path /backed-up/db
   --writers-frozen`. The wrapper must exec Restic with its configured repository and
   credentials. The command retrieves the checkpoint itself, checks SQLite integrity,
   compares every table's complete contents with the frozen live database, and creates
   and reads back the external head. It refuses an existing authority.
5. Start the reviewed service with its private configuration. Verify normal publishing,
   repeated publication with the same key, permission revocation, and protected reads.
   Preserve all valid backups for the owner-approved retention interval; no recovery
   command automatically deletes or prunes anything.

If activation fails after preparation, keep serving closed. Recover using the external
authority if it exists. A pre-activation backup is a rollback only while no newer writes
have been accepted. Never deploy an old writer against a prepared recovery database.

## Recovery and checkpoint maintenance

Run `recover --config /private/recovery.json --restic /absolute/restic-wrapper
--output /new/private/directory --writers-frozen` on an independent machine. The command
retrieves the exact checkpoint identified by the authenticated head, verifies its digest,
replays the committed chain, verifies each resulting security-state fingerprint and
SQLite integrity, and regenerates the local policy journal. Only a successful result
promotes the private temporary directory. An existing output directory is refused;
a failed run can leave a reserved empty output directory. A moving head is refused.

The result contains `testrun.db`, `testrun.db.policies.json`, and a private JSON receipt.
Start only one recovered service with the same recovery configuration. Recheck revoked
access through HTTP before changing routing. The original host must remain fenced.
`status --database file:/absolute/testrun.db --config /private/recovery.json` compares
local progress and security state with the external head; it performs no repair.

To bound replay time, stop the writer, take a fresh off-host Restic checkpoint, and run
`checkpoint` with the same arguments as `bootstrap`. It retrieves and compares the full
checkpoint, requires the current sequence and permissions, and advances the head with a
conditional write. Restart the writer afterwards. Historical snapshots and records are
retained. Schedule this operation based on measured replay duration and the recovery-time
objective; backup completion alone does not advance the authority's checkpoint.

## Compatibility and acceptance limits

All supported runtime mutations must use the wrapped client's transactions. Direct DML,
bulk bypass methods, runtime DDL and volatile SQL expressions are refused. Generated
identities and timestamps must be bound arguments. Existing HTML/Plans, team membership,
publisher permissions, schema-one publications and legacy run/asset mutations are covered.
A transaction that encounters a SQL or guard error cannot commit partial work. Retention
runs without eligible content do not append recovery records.

This is not general SQLite replication. Schema changes require a recovery-compatible
migration and newly verified checkpoint; an incompatible schema or unjournaled security
state fails closed. Records are bounded to 64 MiB. Recovery needs the provider, the
independent encryption key, the referenced Restic snapshot, compatible application code,
and a fenced previous writer. Do not infer a complete host RTO from database-only timings.

Verification lives in `tests/recovery-authority.test.ts`, `tests/recovery-storage.test.ts`
and the built-service readiness suite. Actual provider permissions, credential recovery,
full checkpoint retrieval and authenticated HTTP acceptance require operational evidence
in addition to those tests. This document describes the implementation, not a claim that
any particular production host has enabled it.
