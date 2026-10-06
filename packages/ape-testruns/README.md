# OpenApe Reports CLI

This package provides `ape-reports` for finished HTML documents and the compatible
`ape-testruns` uploader. The single-file commands are available in the published 0.4.0 release.
Reports and migrated Plans use the same production collection; legacy uploads
and Plans URLs remain compatible.

```sh
npm install -g @openape/ape-testruns
apes login you@example.com
ape-reports --version
ape-reports --help
```

The shared login keeps audience `testrun.openape.ai`; the default endpoint is
`https://report.openape.ai`. No command sends email or chat notifications.
See [complete generated command help](REPORTS-CLI.md) and `ape-reports docs`.

## Publish your own file

Write a complete UTF-8 HTML document. Inline CSS, JavaScript, data, images and fonts
in that file; inline SVG and canvas work. No template, directory, ZIP, manifest,
companion file or asset upload is needed.

```sh
ape-reports preview ./analysis.html
ape-reports publish ./analysis.html --category Analyses --tag capacity --key analysis-v1
ape-reports show DOCUMENT_ID --json
ape-reports open DOCUMENT_ID
```

Private owner access and permanent retention are the defaults for every category.
Preview validates locally without login. `--check` or `--json` exits without opening
a browser. Hosted HTML runs on an isolated content origin after an explicit click.
Publisher code remains active and may transmit document data; isolation protects
Reports authentication and application APIs, and is not an absolute network barrier.
Only open code from a publisher you trust. Exported HTML is the exact original file;
use `preview` to retain the hosted browser policy locally.

Maximum HTML is 20 MiB; each embedded resource is at most 8 MiB. Unsupported relative
resources and misleading embedded MIME declarations fail before storage. Optional
external images must use absolute HTTPS URLs. Reports lists those references but
never fetches, proxies or stores their bytes. The reader's browser contacts that
provider, so the image can change or disappear independently of an immutable version.

## Three working journeys

The installed package includes `examples/analysis.html`, `examples/testrun.html` and
`examples/plan.html`. Each works as one file offline, including its image, font,
SVG and interactive chart. Copy a file from the package's `examples` directory into
your project; `npm root -g` identifies that directory for a global installation.
The test-report example is a synthetic template, not evidence that your code passed.
Replace its sample data with actual commands, tested commit, outcomes and inspected
screenshots embedded as data URLs before publishing real evidence.

```sh
# General report, authored directly
ape-reports publish ./analysis.html --category Analyses --tag reports --tag consolidation --key analysis-v1

# Actual test evidence
ape-reports publish ./verification.html --category 'Test Runs' --tag reports --tag consolidation --key verification-run-123

# Plan with explicit team access and status metadata
ape-reports publish ./plan.html --team TEAM_ID --category Plans --tag reports --tag consolidation --meta plans.status=draft --key plan-v1
ape-reports update DOCUMENT_ID --expected-version 1 --meta plans.status=done --key plan-done

# Discover connected documents, then narrow the category
ape-reports list --tag reports --tag consolidation
ape-reports list --category 'Test Runs' --tag reports
ape-reports list --category Plans --meta plans.status=done
ape-reports history DOCUMENT_ID
ape-reports export DOCUMENT_ID --revision 1 --output ./saved.html
```

An optional local renderer is included: `node examples/render-plan.mjs input.json
plan.html`, where input contains `title` and `description` strings. It escapes input
and creates a new single HTML file without overwriting an existing output. Keep
custom templates with their repository, skill or Pod. Changing a template affects
only later publications. Plans status is plain metadata and never owner approval;
record explicit approval separately, with the version or digest it approved.

## Versions, retries and policy

```sh
ape-reports publish ./analysis.html --document DOCUMENT_ID --expected-version 1 --key analysis-v2
ape-reports receipt --key analysis-v2
ape-reports show DOCUMENT_ID --revision 1 --json
ape-reports access set DOCUMENT_ID --reader alice@example.com --reader bob@example.com --expected-access-revision 1
ape-reports retention set DOCUMENT_ID --expires-in 7d --expected-retention-revision 1
ape-reports rm DOCUMENT_ID --expected-version 2
ape-reports restore DOCUMENT_ID --permanent
```

Stable links follow the latest version. Exact version links, source bytes and metadata
snapshots remain immutable. An update never renews expiry. Content, access and lifetime
changes use their respective expected revisions; a conflict requires reconciliation.
After an unknown write outcome, retain the same key and exact bytes/options, query its
receipt or retry identically. Never invent a new key to resolve uncertainty.

Audience and lifetime apply to every version. Public exposes the full history; named
readers must authenticate with the listed verified email. Team membership is separate
from category and tags. Labels cannot grant access. Metadata flags override inert
`script#openape-report[type="application/json"]` defaults; run `docs metadata`.

Expiry or removal immediately denies reads even if cleanup is stopped. Recovery lasts
30 days, requires an explicit new lifetime and starts owner-only. Previous reader,
public and team access is never restored automatically. Then online content is purged;
a minimal retry tombstone prevents resurrection. Backups have separate retention.

## Compatibility

Existing `ape-testruns upload` accepts its existing manifest and screenshots; its old
links remain valid. Version-1 publishers and daily briefing receipts retain their
existing contracts. New HTML publication creates no companion assets.

Old Plans URLs and `ape-plans` remain supported through an authenticated legacy-host
adapter. Install the release with mandatory version checks before writing after
consolidation. Old unversioned API writes receive HTTP 428 with an upgrade explanation;
reads stay compatible. Legacy source edits preserve Markdown/HTML source per version
and render with the bundled compatibility renderer. Generic HTML plans need no renderer.
