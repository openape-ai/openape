# Report templates and legacy retirement — issue 1437

Owner-approved design: https://report.openape.ai/d/01M49MYRK3TBJ850CR0S0GYGQW
Approved implementation plan: https://report.openape.ai/d/01M49KKGQCJP11RP8XQQT75835

The package `@openape/ape-testruns` owns the offline renderer and templates.
`ape-report-render test-run|plan INPUT OUTPUT` produces one HTML document;
`ape-reports` publishes it and manages the existing teams. The native routes use the same `reports:read`/`reports:manage` scopes already
required by the Reports compatibility routes; their catalog entries list the
new aliases explicitly. Both Plans and HTML write freezes protect the shared
team store. Team deletion refuses remaining generic reports even with `--force`;
the owner must change their access explicitly through the existing policy API.
The new runtime
`marked`/`sanitize-html` dependencies reuse the established rendering stack.
The [input contract](../../packages/ape-testruns/RENDERING.md) documents the schema,
image limits, evidence requirements and replacement behavior.

## Producer inventory, October 7, 2026

| Owner / surface | Evidence | Action |
| --- | --- | --- |
| OpenApe Pods evidence scripts | `apps/openape-pods/scripts/browser-report.mjs`, `redesign-evidence.mjs` | Suggested publication now renders the existing manifest, then publishes one private HTML file; no tests or notifications are triggered by this migration. |
| IURIO PR monitor | Active hash `158083853caa5f07eec600317cc194afd2a058a99eac123d3a0fb6307e9b6df8` | Already uses schema-1 `/api/reports` and receipt recovery. Preserved. |
| Morning briefing sender | Active hash `ce3ac5cbfc2b8e0f910dd036a8a4a23b62d42833797c0e25cac19c443e4c1009` | Already uses the supported briefing API. Preserved. |
| Linde server report | Paused hash `be3ba0bcbfb31c55b1a085a2187c8863b867dba9233f12bdc697159136365373` | Already uses schema-1 `/api/reports`. Preserved paused state and delivery checkpoint. |
| Other accessible Pod scripts | Central inventory: 38 Pods, 32 with active script hashes; 21 accessible source reads including the three report publishers | No matching old CLI/write endpoint in the other 18 successfully read sources. Eleven network-member version reads were unavailable through this read surface; inventory remains incomplete. No Pod, network or schedule was changed. |
| Local repositories under `~/Companies` | Scoped search: 51 matching files, excluding dependency/build/worktree/archive/history output | Most are historical standalone Plans checkout, service implementations, docs and compatibility E2E fixtures. `iurioServer/.auto-code/pr.md` is workflow guidance; the `jjq-nuxt/test/e2e/full-suite.mjs` hit is a comment describing generated manifests, not an uploader invocation. Keep project instructions synchronized before retirement. |
| Local schedules | No user crontab; LaunchAgents scan found only a token-refresh backup mentioning old CLIs | No scheduled report uploader found there. Legacy `~/.config/openape-worker/sys.txt` still names old CLI permissions; do not infer that its runtime is retired. |
| Troop workflow guidance | Read the live Delta Mind organization tree; `vars.tooling.review.testrun` still names `ape-testruns`, inherited by four child nodes | Reconcile the authoritative tooling configuration and executor command contract before retiring the old CLI. No workflow was run. |
| Agent guidance | Repository guides, `.claude` references/skills, authoritative vault | Switch current authoring instructions after the released CLI is installed; preserve historical records. |
| Server access history | Production Reports logs contain only startup; Coolify proxy configuration has no access logging | A retrospective 30-day clean-write claim is impossible. No retirement gate is met by absent telemetry. |

## Observation and removal gate

The Reports service emits `reports-legacy-observation-start` at startup and
`reports-legacy-write` after old `/api/runs` or `/api/plans-compat` write attempts.
Only timestamp, method, route family and response status are logged; no tokens,
identities, document IDs, query strings or body data. These events do not include
native team operations or supported schema-1 report/briefing publication.

Retain and inspect the deployment's logs throughout observation. A lost log segment,
container replacement, unidentified caller or incomplete producer inventory prevents
a clean-period claim. An attempt is evidence of a remaining caller even when it fails.
Seven quiet days cannot begin before the remaining callers are reconciled and
observation is verified. The missing retrospective history remains explicit.

This release deprecates authoring commands but retains the compatibility package,
upload and write routes. Do not remove them merely because the CLI release shipped.
Removal is a follow-up implementation with its own exact-source checks, preserved
old reads/redirects, and tested deployment rollback. Do not retry scheduled producers
or send test notifications to establish acceptance.
