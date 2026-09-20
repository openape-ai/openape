# Native development issues

Implementation follows [the approved plan](https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M2A5ZAT63A04PWGVBT5M14MW)
and [issue 1356](https://repos.openape.ai/patrick/monorepo/issues/1356).
The approved private monorepo pilot is live since September 20, 2026. Forgejo
retains the read-only issue archive and CI; native issues own development state.
See the [cutover receipt](native-issues-migration.md#production-pilot-september-20-2026)
for verified counts, recovery constraints and the observation period.

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

The issue capability defaults off (`NUXT_PUBLIC_ISSUES_ENABLED=false`). New tables do not move
production issue authority or change Git transport, mirror or merge behavior. Reporting
also needs explicitly configured intake and routing ownership. Reserve the reviewed
Forgejo number range before enabling native writes in the migration destination.

Permanent behavioral tests cover consequential contracts: private-data isolation,
revocation, scoped delegation, idempotency, concurrent numbering, stale edits and
migration rollback. They extend the existing Git and auth Vitest suites without a new
runner or default-chain change. UI/API/CLI delivery and isolated migration rehearsal
follow in the next increments; this foundation alone is not a completed issue tracker.

## API and CLI (M2)

Enable only for an approved rollout or isolated fixture: `NUXT_PUBLIC_ISSUES_ENABLED=true`.
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

## M3: repository and ecosystem UI

`NUXT_PUBLIC_ISSUES_ENABLED=true` enables both navigation and issue handlers;
its default is false. This replaces the earlier server-only development flag.
It exposes no private configuration or authorization data. Repository owner
names `issues`, `i` and `report` are reserved; the read-only production inventory
had no conflicting owner names before these routes were introduced.

The repository Issues tab offers creation, Markdown Write/Preview, discussion,
versioned edits, close/reopen, labels and assignment. `/issues` carries search,
state, repository, product, label, assignee and reporter filters in its URL.
Pagination replaces the displayed page so an older page cannot retain records
from a repository whose grant was revoked before the next request. Stable
`/i/:id` links omit repository navigation for participants without code access.
Comment anchors load the necessary discussion pages before scrolling.

`GET /api/issue-facets` derives choices from live readable records/repositories;
`POST /api/issue-preview` uses the same sanitizer, scopes, body limits and
same-origin mutation checks as persisted Markdown. Neither endpoint has a public
cache. The frontend preserves drafts after network/conflict errors, reuses retry
keys for unchanged submissions and requires an explicit reload after conflicts.
Forms accept input only after hydration, avoiding loss of very early input.

The approved `test:e2e` and `test:layout` suites are registered in the shared
check contract. Both boot the real Nuxt application and the shared disposable
DDISA IdP. The CLI exchanges a real IdP token; the browser receives only cookies
produced by a complete OIDC callback. There is no test authentication bypass.
Playwright uses the repository's existing pinned dependency and installed Chrome;
the shared fixture dependency avoids a second identity protocol implementation.
Layout tests load actual application CSS at 390 and 1440 pixels and emit synthetic
screenshots, `testrun.json` and a self-contained `report.html` under
`apps/openape-git/.artifacts/issues/`. Unit/component tests additionally protect
retry keys, draft retention, permission changes and participant-only controls.

## M4: product reporting and intake triage

`/report?product=plans` retains product selection through the existing login return
path. The form shows a safe product name and audience description before submission.
No app credentials, diagnostics or page contents are transferred. Unknown or disabled
products route to the configured private intake, never to a client-selected repository.
Configure `NUXT_ISSUE_INTAKE_REPO_ID` and `NUXT_ISSUE_ROUTING_ADMIN` explicitly at rollout.
An unavailable intake returns 503 and keeps the draft; no issue is silently discarded.

`GET /api/products?product=KEY` requires `products:read` and returns enabled product
names and a versioned audience descriptor without private repository namespaces.
`POST /api/reports` requires `reports:create`, `Idempotency-Key`, `productKey`
(or null), `routingVersion`, `title` and `body`. A changed destination returns 409;
the UI retains the text and requires a new audience review. A retry of a committed
report still resolves its original identity after the route changes.

Under a repository's Access settings, administrators can enable reporting and maintain
existing product names. Creating or moving a product route also requires the configured
routing administrator to hold destination repository administration. Versioned routes:
`GET/PATCH R/issue-policy` and `PUT R/issue-products/:key`. New products use version zero.

`POST I/transfer` (also `/api/issue-records/:id/transfer`) requires live source triage
and destination write access, an approved `productKey`, `expectedVersion` and explicit
`labelMap` from every source label ID to a destination label ID or null. Only configured
intake issues can move. ID, comments, participant access and old number aliases remain;
a destination number is allocated, assignment is cleared and the transfer is audited.
`GET I/transfer-options` offers only destinations writable by the caller.
The ecosystem list supports `triage=unclassified` for the intake queue.

`POST I/moderation` requires administration, `expectedVersion`, a nonempty `reason`
and `hidden` and/or `revokeParticipant`. Hidden issues disappear from non-admin reads;
revoked participants immediately lose their narrow access. Reporter membership never
confers repository read access. The same commands are available through the CLI:

```sh
pnpm git:cli -- issue product list --product plans
pnpm git:cli -- report create --product plans --routing-version REVIEWED_HASH --title 'Describe the problem' --body-file /tmp/report.md --idempotency-key report-retry-001
pnpm git:cli -- issue policy set --repo owner/repository --enabled true --expected-version 1
pnpm git:cli -- issue product set --repo owner/repository --product plans --name Plans --enabled true --expected-version 0
pnpm git:cli -- issue transfer --id ISSUE_ID --product plans --label-map-file /tmp/labels.json --expected-version 1
pnpm git:cli -- issue moderate --id ISSUE_ID --revoke-participant reporter@example.com --reason 'Access withdrawn' --expected-version 2
```

Issue timestamps use Unix milliseconds; legacy Git registry timestamps retain their
existing seconds. Import tooling must convert explicitly rather than copy values blindly.
Production intake creation, product registration and feature activation remain part of
the separately approved rollout. Reporting links in other app shells and external-code
issue homes follow as independently reviewable changes.

## M5: explicit pull request relations

An issue's **Linked pull requests** panel adds and removes `Related` relations.
A reciprocal panel appears on the existing PR detail page. Both panels are behind
the issue capability flag; PR merge behavior does not depend on issue availability.

`GET/POST I/pulls` and `DELETE I/pulls/:pullId` also exist under the stable
`/api/issue-records/:id` path. POST accepts `{ repository: "owner/name", number: 7 }`.
Writes require `issues:triage`, live issue triage permission and write permission on
the PR repository. Adding the same relation twice is idempotent. Removal is audited.
`GET R/pulls/:number/issues` returns the reciprocal view. Reads require `issues:read`
and current read access to both the issue and the PR repository. Inaccessible links
are omitted entirely, including their count, title, namespace, number and URL.

The PR's current state is read from the existing record. A successful merge never
closes the issue; maintainers can comment and explicitly close it after verification.
Closing or reopening either record does not remove its relation.

```sh
pnpm git:cli -- issue link --id ISSUE_ID --pull-repo owner/repository --pull-number 7
pnpm git:cli -- issue links --id ISSUE_ID
pnpm git:cli -- pr issues 7 --repo owner/repository
pnpm git:cli -- issue unlink --id ISSUE_ID --pull-id PULL_ID
```

The existing signed HTTP suite covers both access directions, duplicate relations,
write denial, hidden targets and audit entries. The real IdP/CLI/browser suites
create a real PR over isolated Git refs, link it, merge the exact reviewed SHAs,
observe `merged` beside an issue that remains `open`, and remove the relation.
Existing merge-protection tests remain unchanged and mandatory.

## External-code issue homes

Create a fresh issue-only repository with `POST /api/repos` using
`{ owner, name, issueHomeOnly: true, codeSourceUrl: "https://code.example/owner/project" }`.
The signed-in namespace owner needs the existing `repos:write` capability; feature
activation is required. The normal creation page exposes the same choice. CLI:
`pnpm git:cli -- repo create --repo owner/project --code-source https://code.example/owner/project`.
Existing repositories cannot be converted by creation or overwritten. Code URLs require
HTTPS and reject credentials, queries and fragments. The service never fetches this URL.

No bare Git directory is created. Code reads, Git transport, native PRs, mirrors,
webhooks and branch protection setup reject the issue-only home. The header shows
**Development issues** and **View external code**; native Code/Commits/Pulls tabs and
mirror/webhook controls are hidden. The root repository URL navigates to its issues.
The existing Git authority and remote pipelines remain unchanged.

`GET R/metadata` exposes only owner/name, issue-home mode and code source after strict
scope and live repository read checks. It never returns grant or webhook configuration.
This allows ordinary issue readers to see the right navigation without using the
owner-only Access endpoint. Reports with participant-only access still get no repo header.

Real authenticated API and browser tests verify fresh registration, no Git storage,
private metadata, issue creation, external navigation, and denial of Git/mirror writes.
The same fixture successfully reads a normal Git repository as a control. Initial
issue-home registration and owner mapping in production remain rollout decisions.


## Imported issues and archive links (M6)

See [the migration operator and rehearsal runbook](native-issues-migration.md).
Issue detail and comments distinguish original Forgejo authors from native
identities. Imported files download through authenticated
`GET /api/issue-attachments/:id` with live access and integrity checks.
`GET /api/issue-legacy?url=ENCODED_SOURCE_URL` resolves only authorized original
issue/comment links; `/legacy` preserves comment fragments across sign-in.
Imported Markdown remains byte-for-byte source text, with authorization-filtered
rendered references. Staged repositories return 503 for issue writes until the
separately reviewed cutover releases their database fence. Git/PR operations
retain their existing lifecycle.
