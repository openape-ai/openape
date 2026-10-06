# ape-reports CLI reference

Generated from the built command definitions with `node scripts/generate-reports-help.mjs`.

## Root

```text
Publish one HTML file. Read, organize and version reports.

USAGE  ape-reports <command> [options]

COMMANDS
  whoami         Show identity and configured service
  preview        Preview one HTML file locally or validate without a browser
  publish        Create a document or publish a complete new version
  update         Publish metadata changes with unchanged HTML
  list           Search accessible documents
  show           Show version metadata, access, expiry and links
  history        List immutable editions, newest first
  open           Open a report in the browser
  export         Save the exact published HTML file
  receipt        Recover an exact publication receipt
  categories     List accessible categories and document counts
  tags           List accessible tags and document counts
  teams          List teams and caller roles, including archived teams
  teams create   Create a team; the caller becomes owner
  teams show     Show a team, its members and legacy plans
  teams members  List team members and roles
  teams update   Rename a team or change its description
  teams invite   Create a team invitation
  teams invites  List active team invitations
  teams revoke-invite Revoke an invitation
  teams accept   Accept an invitation URL or token
  teams remove-member Remove a member from a team
  teams archive  Archive a team
  teams unarchive Restore an archived team
  teams rm       Delete a team; refuses remaining plans unless forced
  access         Inspect or replace document access
  retention      Inspect or explicitly change lifetime
  rm             Remove with a 30-day recovery period
  restore        Restore privately with an explicit new lifetime
  docs           Explain formats, authentication and workflows

OPTIONS
  --help  Show root or command help
  --json  Structured stdout; errors on stderr
  --quiet  Suppress progress, not results or errors
  --endpoint <value>  Reports service; default https://report.openape.ai; APE_REPORTS_ENDPOINT
  --version  Show executable version; root command only

Run apes login <email> once; ape-reports uses the existing shared session. Start with preview ./plan.html, then publish ./plan.html --category Plans --key plan-v1. No command sends notifications.
```

## whoami

```text
Show identity and configured service

USAGE  ape-reports whoami

OPTIONS
  --help  Show root or command help
  --json  Structured stdout; errors on stderr
  --quiet  Suppress progress, not results or errors
  --endpoint <value>  Reports service; default https://report.openape.ai; APE_REPORTS_ENDPOINT

Uses the shared apes login. No credentials are printed.
```

## preview

```text
Preview one HTML file locally or validate without a browser

USAGE  ape-reports preview <file.html>

OPTIONS
  --help  Show root or command help
  --json  Structured stdout; errors on stderr
  --quiet  Suppress progress, not results or errors
  --endpoint <value>  Reports service; default https://report.openape.ai; APE_REPORTS_ENDPOINT
  --title <value>  Override title; final title must be nonempty
  --language <value>  Set an HTML language tag
  --category <value>  Set one optional category
  --tag <value>...  Repeatable; replace the complete tag list
  --meta <value>...  Repeatable namespaced key=value; override one text field
  --clear-category  Remove the category
  --clear-tags  Remove all tags
  --clear-language  Remove language metadata
  --unset-meta <value>...  Repeatable; remove a metadata key
  --check  Validate only; no server or network
  --port <value>  Loopback viewer port; default a free port

--json implies --check. No login, upload or notification. External image dependencies are listed. Ctrl-C stops the isolated local viewer.
```

## publish

```text
Create a document or publish a complete new version

USAGE  ape-reports publish <file.html> --key <key>

OPTIONS
  --help  Show root or command help
  --json  Structured stdout; errors on stderr
  --quiet  Suppress progress, not results or errors
  --endpoint <value>  Reports service; default https://report.openape.ai; APE_REPORTS_ENDPOINT
  --title <value>  Override title; final title must be nonempty
  --language <value>  Set an HTML language tag
  --category <value>  Set one optional category
  --tag <value>...  Repeatable; replace the complete tag list
  --meta <value>...  Repeatable namespaced key=value; override one text field
  --clear-category  Remove the category
  --clear-tags  Remove all tags
  --clear-language  Remove language metadata
  --unset-meta <value>...  Repeatable; remove a metadata key
  --expected-version <value>  Required current document version; stale writes fail
  --key <value>  Required idempotency key; retain after an uncertain outcome
  --private  Owner only
  --public  Anyone can read all versions without login
  --reader <value>...  Repeatable verified-email reader; replaces the reader list
  --team <value>  Existing team ID
  --permanent  No automatic expiry
  --expires-in <value>  Positive integer m/h/d, resolved once by the server
  --expires-at <value>  Future RFC3339 timestamp with timezone
  --document <value>  Existing document ID; requires --expected-version
  --series-id <value>  New document only; existing owner/publisher-bound series

Exactly one UTF-8 HTML file. Private and permanent by default. No directories, ZIPs, manifests or companions. Audience, lifetime and series flags are creation-only. Updates preserve them. Omitted optional metadata is absent in the new version. Retry identical bytes/options with the same key. Receipts describe original policy, not current policy.
```

## update

```text
Publish metadata changes with unchanged HTML

USAGE  ape-reports update <document-id> --expected-version <n> --key <key>

OPTIONS
  --help  Show root or command help
  --json  Structured stdout; errors on stderr
  --quiet  Suppress progress, not results or errors
  --endpoint <value>  Reports service; default https://report.openape.ai; APE_REPORTS_ENDPOINT
  --title <value>  Override title; final title must be nonempty
  --language <value>  Set an HTML language tag
  --category <value>  Set one optional category
  --tag <value>...  Repeatable; replace the complete tag list
  --meta <value>...  Repeatable namespaced key=value; override one text field
  --clear-category  Remove the category
  --clear-tags  Remove all tags
  --clear-language  Remove language metadata
  --unset-meta <value>...  Repeatable; remove a metadata key
  --expected-version <value>  Required current document version; stale writes fail
  --key <value>  Required idempotency key; retain after an uncertain outcome

At least one change is required. Unspecified fields remain unchanged. Creates an immutable version without parsing or rerendering HTML. Changes do not edit text drawn inside the document.
```

## list

```text
Search accessible documents

USAGE  ape-reports list

OPTIONS
  --help  Show root or command help
  --json  Structured stdout; errors on stderr
  --quiet  Suppress progress, not results or errors
  --endpoint <value>  Reports service; default https://report.openape.ai; APE_REPORTS_ENDPOINT
  --limit <value>  Page size 1–100, default 20
  --cursor <value>  Opaque next_cursor from the previous response
  --search <value>  Search titles
  --category <value>  Exact normalized category
  --tag <value>...  Repeatable; all tags must match
  --meta <value>...  Repeatable key=value; all metadata must match
  --team <value>  Accessible team ID
  --series-id <value>  Accessible series ID
  --deleted  Only recoverable expired/deleted documents

One latest edition per document. Filters combine with AND; current authorization and expiry apply before pagination. JSON: items and next_cursor. No global public directory.
```

## show

```text
Show version metadata, access, expiry and links

USAGE  ape-reports show <document-id>

OPTIONS
  --help  Show root or command help
  --json  Structured stdout; errors on stderr
  --quiet  Suppress progress, not results or errors
  --endpoint <value>  Reports service; default https://report.openape.ai; APE_REPORTS_ENDPOINT
  --revision <value>  Immutable edition number; default latest

Does not execute HTML. Includes digests and external-image dependencies. Use export for the HTML body.
```

## history

```text
List immutable editions, newest first

USAGE  ape-reports history <document-id>

OPTIONS
  --help  Show root or command help
  --json  Structured stdout; errors on stderr
  --quiet  Suppress progress, not results or errors
  --endpoint <value>  Reports service; default https://report.openape.ai; APE_REPORTS_ENDPOINT
  --limit <value>  Page size 1–100, default 20
  --cursor <value>  Opaque next_cursor from the previous response

Each edition includes author, timestamp and its exact URL.
```

## open

```text
Open a report in the browser

USAGE  ape-reports open <document-id>

OPTIONS
  --help  Show root or command help
  --json  Structured stdout; errors on stderr
  --quiet  Suppress progress, not results or errors
  --endpoint <value>  Reports service; default https://report.openape.ai; APE_REPORTS_ENDPOINT
  --revision <value>  Immutable edition number; default latest

--json returns the selected URL without launching a browser. Defaults to the stable latest URL.
```

## export

```text
Save the exact published HTML file

USAGE  ape-reports export <document-id> --output <file.html>

OPTIONS
  --help  Show root or command help
  --json  Structured stdout; errors on stderr
  --quiet  Suppress progress, not results or errors
  --endpoint <value>  Reports service; default https://report.openape.ai; APE_REPORTS_ENDPOINT
  --revision <value>  Immutable edition number; default latest
  --output <value>  Required local output path
  --overwrite  Explicitly replace an existing file

Does not fetch or embed external images. Downloaded files have no hosted HTTP isolation policy; use preview. --json writes the file and prints an export receipt.
```

## receipt

```text
Recover an exact publication receipt

USAGE  ape-reports receipt --key <key>

OPTIONS
  --help  Show root or command help
  --json  Structured stdout; errors on stderr
  --quiet  Suppress progress, not results or errors
  --endpoint <value>  Reports service; default https://report.openape.ai; APE_REPORTS_ENDPOINT
  --key <value>  Required idempotency key; retain after an uncertain outcome

Lookup is scoped to the authorized publication identity. Never submit with a new key to resolve an unknown write outcome.
```

## categories

```text
List accessible categories and document counts

USAGE  ape-reports categories

OPTIONS
  --help  Show root or command help
  --json  Structured stdout; errors on stderr
  --quiet  Suppress progress, not results or errors
  --endpoint <value>  Reports service; default https://report.openape.ai; APE_REPORTS_ENDPOINT
  --limit <value>  Page size 1–100, default 20
  --cursor <value>  Opaque next_cursor from the previous response
  --search <value>  Filter labels
  --team <value>  Accessible team ID

No setup required. Current editions only; private labels are never exposed.
```

## tags

```text
List accessible tags and document counts

USAGE  ape-reports tags

OPTIONS
  --help  Show root or command help
  --json  Structured stdout; errors on stderr
  --quiet  Suppress progress, not results or errors
  --endpoint <value>  Reports service; default https://report.openape.ai; APE_REPORTS_ENDPOINT
  --limit <value>  Page size 1–100, default 20
  --cursor <value>  Opaque next_cursor from the previous response
  --search <value>  Filter labels
  --category <value>  Restrict suggestions to a category
  --team <value>  Accessible team ID

NFC, whitespace normalization, lowercase and deduplication. At most 20 tags of 64 code points. Labels grant no permissions and trigger no action.
```

## teams

```text
List teams and caller roles, including archived teams

USAGE  ape-reports teams

OPTIONS
  --help  Show root or command help
  --json  Structured stdout; errors on stderr
  --quiet  Suppress progress, not results or errors
  --endpoint <value>  Reports service; default https://report.openape.ai; APE_REPORTS_ENDPOINT
  --limit <value>  Page size 1–100, default 20
  --cursor <value>  Opaque next_cursor from the previous response

Use teams create, show, members, update, invite, invites, accept, revoke-invite, remove-member, archive, unarchive or rm. No default team is silently applied to private publications.
```

## teams create

```text
Create a team; the caller becomes owner

USAGE  ape-reports teams create <name>

OPTIONS
  --help  Show root or command help
  --json  Structured stdout; errors on stderr
  --quiet  Suppress progress, not results or errors
  --endpoint <value>  Reports service; default https://report.openape.ai; APE_REPORTS_ENDPOINT
  --description <value>  Team description

Uses the Reports team store and existing role checks. Does not send notifications. Invitations confer editor access when accepted; preserve tokens privately.
```

## teams show

```text
Show a team, its members and legacy plans

USAGE  ape-reports teams show <team-id>

OPTIONS
  --help  Show root or command help
  --json  Structured stdout; errors on stderr
  --quiet  Suppress progress, not results or errors
  --endpoint <value>  Reports service; default https://report.openape.ai; APE_REPORTS_ENDPOINT

Uses the Reports team store and existing role checks. Does not send notifications. Invitations confer editor access when accepted; preserve tokens privately.
```

## teams members

```text
List team members and roles

USAGE  ape-reports teams members <team-id>

OPTIONS
  --help  Show root or command help
  --json  Structured stdout; errors on stderr
  --quiet  Suppress progress, not results or errors
  --endpoint <value>  Reports service; default https://report.openape.ai; APE_REPORTS_ENDPOINT

Uses the Reports team store and existing role checks. Does not send notifications. Invitations confer editor access when accepted; preserve tokens privately.
```

## teams update

```text
Rename a team or change its description

USAGE  ape-reports teams update <team-id>

OPTIONS
  --help  Show root or command help
  --json  Structured stdout; errors on stderr
  --quiet  Suppress progress, not results or errors
  --endpoint <value>  Reports service; default https://report.openape.ai; APE_REPORTS_ENDPOINT
  --name <value>  New team name
  --description <value>  New description; empty clears it

Uses the Reports team store and existing role checks. Does not send notifications. Invitations confer editor access when accepted; preserve tokens privately.
```

## teams invite

```text
Create a team invitation

USAGE  ape-reports teams invite <team-id>

OPTIONS
  --help  Show root or command help
  --json  Structured stdout; errors on stderr
  --quiet  Suppress progress, not results or errors
  --endpoint <value>  Reports service; default https://report.openape.ai; APE_REPORTS_ENDPOINT
  --max-uses <value>  Positive integer, default 5
  --expires-in <value>  Duration, default 7d
  --note <value>  Invitation note

Uses the Reports team store and existing role checks. Does not send notifications. Invitations confer editor access when accepted; preserve tokens privately.
```

## teams invites

```text
List active team invitations

USAGE  ape-reports teams invites <team-id>

OPTIONS
  --help  Show root or command help
  --json  Structured stdout; errors on stderr
  --quiet  Suppress progress, not results or errors
  --endpoint <value>  Reports service; default https://report.openape.ai; APE_REPORTS_ENDPOINT

Uses the Reports team store and existing role checks. Does not send notifications. Invitations confer editor access when accepted; preserve tokens privately.
```

## teams revoke-invite

```text
Revoke an invitation

USAGE  ape-reports teams revoke-invite <invite-id>

OPTIONS
  --help  Show root or command help
  --json  Structured stdout; errors on stderr
  --quiet  Suppress progress, not results or errors
  --endpoint <value>  Reports service; default https://report.openape.ai; APE_REPORTS_ENDPOINT

Uses the Reports team store and existing role checks. Does not send notifications. Invitations confer editor access when accepted; preserve tokens privately.
```

## teams accept

```text
Accept an invitation URL or token

USAGE  ape-reports teams accept <url-or-token>

OPTIONS
  --help  Show root or command help
  --json  Structured stdout; errors on stderr
  --quiet  Suppress progress, not results or errors
  --endpoint <value>  Reports service; default https://report.openape.ai; APE_REPORTS_ENDPOINT

Uses the Reports team store and existing role checks. Does not send notifications. Invitations confer editor access when accepted; preserve tokens privately.
```

## teams remove-member

```text
Remove a member from a team

USAGE  ape-reports teams remove-member <team-id> <email>

OPTIONS
  --help  Show root or command help
  --json  Structured stdout; errors on stderr
  --quiet  Suppress progress, not results or errors
  --endpoint <value>  Reports service; default https://report.openape.ai; APE_REPORTS_ENDPOINT

Uses the Reports team store and existing role checks. Does not send notifications. Invitations confer editor access when accepted; preserve tokens privately.
```

## teams archive

```text
Archive a team

USAGE  ape-reports teams archive <team-id>

OPTIONS
  --help  Show root or command help
  --json  Structured stdout; errors on stderr
  --quiet  Suppress progress, not results or errors
  --endpoint <value>  Reports service; default https://report.openape.ai; APE_REPORTS_ENDPOINT

Uses the Reports team store and existing role checks. Does not send notifications. Invitations confer editor access when accepted; preserve tokens privately.
```

## teams unarchive

```text
Restore an archived team

USAGE  ape-reports teams unarchive <team-id>

OPTIONS
  --help  Show root or command help
  --json  Structured stdout; errors on stderr
  --quiet  Suppress progress, not results or errors
  --endpoint <value>  Reports service; default https://report.openape.ai; APE_REPORTS_ENDPOINT

Uses the Reports team store and existing role checks. Does not send notifications. Invitations confer editor access when accepted; preserve tokens privately.
```

## teams rm

```text
Delete a team; refuses remaining plans unless forced

USAGE  ape-reports teams rm <team-id>

OPTIONS
  --help  Show root or command help
  --json  Structured stdout; errors on stderr
  --quiet  Suppress progress, not results or errors
  --endpoint <value>  Reports service; default https://report.openape.ai; APE_REPORTS_ENDPOINT
  --force  Also soft-delete remaining legacy plans

Uses the Reports team store and existing role checks. Does not send notifications. Invitations confer editor access when accepted; preserve tokens privately.
```

## access

```text
Inspect or replace document access

USAGE  ape-reports access show|set <document-id>

OPTIONS
  --help  Show root or command help
  --json  Structured stdout; errors on stderr
  --quiet  Suppress progress, not results or errors
  --endpoint <value>  Reports service; default https://report.openape.ai; APE_REPORTS_ENDPOINT
  --private  Owner only
  --public  Anyone can read all versions without login
  --reader <value>...  Repeatable verified-email reader; replaces the reader list
  --team <value>  Existing team ID
  --expected-access-revision <value>  Required for set; rejects stale policy writes

set requires exactly one audience. Owner/administrator only; series publishers have no administration rights. Owner retains access. Public includes history. No invitation, email or notification. Does not create a content version or revive expired documents.
```

## retention

```text
Inspect or explicitly change lifetime

USAGE  ape-reports retention show|set <document-id>

OPTIONS
  --help  Show root or command help
  --json  Structured stdout; errors on stderr
  --quiet  Suppress progress, not results or errors
  --endpoint <value>  Reports service; default https://report.openape.ai; APE_REPORTS_ENDPOINT
  --permanent  No automatic expiry
  --expires-in <value>  Positive integer m/h/d, resolved once by the server
  --expires-at <value>  Future RFC3339 timestamp with timezone
  --expected-retention-revision <value>  Required for set; rejects stale policy writes

set requires exactly one lifetime. A day is 24 hours. All editions share a deadline; publication never renews it. Expired/deleted documents require restore. Recovery lasts 30 days before online content is purged; backups follow their separate retention.
```

## rm

```text
Remove with a 30-day recovery period

USAGE  ape-reports rm <document-id> --expected-version <n>

OPTIONS
  --help  Show root or command help
  --json  Structured stdout; errors on stderr
  --quiet  Suppress progress, not results or errors
  --endpoint <value>  Reports service; default https://report.openape.ai; APE_REPORTS_ENDPOINT
  --expected-version <value>  Required current document version; stale writes fail

Owner/administrator only. Denies all version reads immediately. Repeated removal does not restart recovery. No immediate hard-delete command.
```

## restore

```text
Restore privately with an explicit new lifetime

USAGE  ape-reports restore <document-id> (--permanent|--expires-in <duration>|--expires-at <time>)

OPTIONS
  --help  Show root or command help
  --json  Structured stdout; errors on stderr
  --quiet  Suppress progress, not results or errors
  --endpoint <value>  Reports service; default https://report.openape.ai; APE_REPORTS_ENDPOINT
  --permanent  No automatic expiry
  --expires-in <value>  Positive integer m/h/d, resolved once by the server
  --expires-at <value>  Future RFC3339 timestamp with timezone

Owner only, within 30 days. Never restores previous readers/public/team access. Series ownership must remain compatible. Restoration after purge is impossible.
```

## docs

```text
Explain formats, authentication and workflows

USAGE  ape-reports docs [topic]

OPTIONS
  --help  Show root or command help
  --json  Structured stdout; errors on stderr
  --quiet  Suppress progress, not results or errors
  --endpoint <value>  Reports service; default https://report.openape.ai; APE_REPORTS_ENDPOINT

Topics: getting-started, html, metadata, versions, auth, sharing, retention, templates, test-runs, plans, errors. No topic prints the index.
```
