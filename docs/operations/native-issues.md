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

## API and CLI (M2)

Enable only on an isolated fixture until rollout approval: `NUXT_ISSUES_ENABLED=true`.
All issue responses are private/no-store. Browser mutations require a matching Origin;
CLI calls use the existing exchanged bearer token. Mutations are limited to 120 per
subject per minute, with a separate 3000-per-minute socket-IP boundary before auth.
Limits reset each minute and return 429 with Retry-After. These are single-process
limits, matching the current service deployment.

Implemented routes (`R = /api/repos/:owner/:name`, `I = R/issues/:number`):

| Route | Operation |
| --- | --- |
| `GET /api/issues`, `GET R/issues` | ACL-filtered title/body search and repository/product/state/label/assignee/reporter filters; bounded cursor pagination |
| `POST R/issues` | Create from title/body; `Idempotency-Key` required |
| `GET I`, `PATCH I` | Read or edit; `expectedVersion` required for text, state, label and assignee changes |
| `GET/POST I/comments` | Paginated discussion; comment creation requires `Idempotency-Key` |
| `PATCH I/comments/:commentId` | Own-text edit or admin redaction with reason; version required |
| `GET/PATCH /api/issue-records/:id` and its comment routes | Same services through stable IDs, including narrow reporter access |
| `GET/POST R/labels`, `PATCH R/labels/:labelId` | Read labels; administrators create, rename or archive them |
| `GET R/issue-assignees` | Maintainers see only identities with current repository access |

Set labels and an assignee with a versioned PATCH after creation. Description and
comment limits are 64 KiB and 32 KiB of UTF-8 Markdown respectively. Input rejects
unknown fields, including authorship/timestamps. Remote Markdown images render as
explicit links; sanitized HTML contains no inline remote images or scripts. The JSON
request limit accommodates escaped Markdown up to its content limit.

Run `pnpm git:cli -- issue --help` for command names. All commands return JSON. Examples:

```sh
pnpm git:cli -- issue create --repo owner/repository --title 'Describe the problem' --body-file /tmp/issue.md --idempotency-key report-2026-09-18-a
pnpm git:cli -- issue list --all-repos --state open --product plans
pnpm git:cli -- issue show 14 --repo owner/repository
pnpm git:cli -- issue show --id STABLE_ISSUE_ID
pnpm git:cli -- issue comment 14 --body-file /tmp/comment.md --idempotency-key comment-2026-09-18-a
pnpm git:cli -- issue close 14 --expected-version 2
pnpm git:cli -- issue assign 14 --assignee reader@example.com --expected-version 3
pnpm git:cli -- issue label 14 --labels LABEL_ID --expected-version 4
pnpm git:cli -- issue labels create --name bug --color '#ef4444'
pnpm git:cli -- issue labels edit --label-id LABEL_ID --archived true --expected-version 1
```

Use `--assignee none` or `--labels none` to clear values. `--label one,two` combines
list filters with AND. `--endpoint` targets an explicitly selected test service.
If creation/commenting omits a retry key, the CLI prints its generated key to stderr
before dispatch; reuse that key after a timeout. A changed payload with the same key
returns `CONFLICT`. Unknown options and missing versions fail before network access.
Issue errors use exit 2 with structured error codes; existing PR/check exit codes retain
their previous semantics. No automatic conflict retry overwrites newer edits.

Verification extends the existing suites with real HTTP requests through the H3
handlers, file-backed SQLite and verified signed SP tokens, plus CLI argument/body-file
and transport checks. M3 adds the actual Nuxt/IdP/CLI exchange and browser-layout suite;
HTTP fixture evidence alone does not claim that full integration gate.
