# Reports authoring

For new Plans and Test Runs, use the local templates from `@openape/ape-testruns`:

```sh
ape-report-render plan plan.json plan.html
ape-report-render test-run run/testrun.json verification.html --commit COMMIT
ape-reports preview verification.html --check
ape-reports publish verification.html --category 'Test Runs' --key RUN_KEY
ape-reports publish plan.html --category Plans --team TEAM_ID --key PLAN_KEY
```

Read the installed `RENDERING.md`, sample JSON and `ape-report-render --help`.
Publish actual test outcomes and personally inspected embedded screenshots. Plan
status is separate from actual owner approval tied to a specific version or digest.
Private owner access and permanent retention are defaults. Manage teams through
`ape-reports teams`; pass team access explicitly when authorized.

Read the current version before replacing a document. Keep the same key and exact
bytes after an unknown write outcome; reconcile conflicts instead of overwriting.
No publishing command sends notifications. Supported schema-1 publishers and old
read links remain compatible. Other documentation topics describe legacy commands
for existing callers during migration; do not choose them for new authoring.
