# Native development issues

Implementation follows [the approved plan](https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M2A5ZAT63A04PWGVBT5M14MW)
and [issue 1356](https://git.openape.ai/openape-ai/openape/issues/1356).
Forgejo remains the production issue authority until the separately approved cutover.

## Storage and authentication foundation (M1)

Startup applies ordered additive SQL migrations in write transactions. Each committed
version has a checksum; a changed historical migration fails startup. The first version
adopts the existing Git registry without replacing PRs, grants, mirrors or protections.
Failed new migrations roll back completely. Code rollback retains additive issue tables.
Back up the registry before rollout; never restore an old full registry over newer Git
metadata to recover an issue migration.

Issue numbers use a transactional per-repository counter and remain independent of PR
numbers. Create/comment requests bind an idempotency key to the verified subject, actual
actor, operation and payload hash. Retry returns the committed identity; different
content returns 409. Keys currently remain stored indefinitely, exceeding the seven-day
minimum retry window. Issue writes are serialized within the single app process. Write transactions also
retry bounded SQLite lock contention; other
failures propagate. Edits require the current version and reject stale revisions.

`requireScopedPrincipal` accepts the existing authenticated SP session or an exchanged
SP bearer token. Raw IdP bearer tokens must first use `/api/cli/exchange`. This opt-in
helper does not use the legacy raw-token verification fallback or conventional scope
fallback. Git configures the issue scope IDs as catalog-only so they cannot authorize
unrelated legacy Git handlers through their conventional fallback. It preserves subject, actual actor and scope bounds. Delegated browser claims
without scope bounds are rejected. The subject supplies resource permissions; the actual
actor supplies audit provenance. Direct agents use their own subject permissions.

Ownership and live repository grants determine read/write/admin access. The same SQL
predicate drives repository discovery and issue visibility before filtering or pagination.
Repository grants are reevaluated on every query; issue participants grant only access
to their individual issue. Reporter serialization omits repository identity and number.
Private issue content is not made public by a code mirror. Labels and assignees require
triage rights, and assignment never creates an access grant.

The issue capability defaults off (`NUXT_ISSUES_ENABLED=false`). New tables do not move
production issue authority or change Git transport, mirror or merge behavior. Reporting
also needs explicitly configured intake and routing ownership. Reserve the reviewed
Forgejo number range before enabling native writes in the migration destination.

Permanent behavioral tests cover consequential contracts: private-data isolation,
revocation, scoped delegation, idempotency, concurrent numbering, stale edits and
migration rollback. They extend the existing Git and auth Vitest suites without a new
runner or default-chain change. UI/API/CLI delivery and isolated migration rehearsal
follow in the next increments; this foundation alone is not a completed issue tracker.
