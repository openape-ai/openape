# ape-testruns — agent reference

You ran tests; now you need to prove the result. testrun.openape.ai turns a
directory of screenshots + one JSON manifest into a public report link you
can paste anywhere — chat, PR description, task comment. The link works
without login (unguessable capability URL).

## End-to-end workflow

1. **Run your tests and capture evidence.** Any tool works (Playwright,
   headless Chrome, curl + screenshots). Save screenshots into a run
   directory, e.g.:

   ```
   out/
   ├─ testrun.json
   ├─ login/01-landing.png
   ├─ login/02-dashboard.png
   └─ logout/01-stuck.png
   ```

2. **Write `testrun.json`.** Format: `ape-testruns docs manifest`.
   Captions are markdown; describe what each screenshot shows and proves.

3. **Upload:**

   ```
   ape-testruns upload ./out
   ```

   stdout is exactly one line: the report URL. Progress goes to stderr.
   Add `--json` for `{ id, slug, url, status, uploaded, missing }`.

4. **Present the link.** That's the deliverable:
   "Proof: https://testrun.openape.ai/r/<slug> (2 passed, 1 failed)".

## Auth

One-time per device: `apes login <email>` (human approves via browser).
After that, ape-testruns works headlessly — it exchanges the apes session
for an SP token automatically. `ape-testruns whoami` verifies.

## Commands

```
ape-testruns upload <dir> [--title …] [--project …] [--summary …] [--json]
ape-testruns list [--limit N] [--json]
ape-testruns show <id>            # JSON: manifest, assets, share URL
ape-testruns open <id> [--print-only]
ape-testruns rm <id>              # share link stops working
ape-testruns whoami [--json]
ape-testruns docs <topic>         # agent, auth, cli, manifest
```

`--endpoint <url>` on any command (or env `APE_TESTRUNS_ENDPOINT`) targets a
non-production instance, e.g. local dev on http://localhost:3006.

## Rules of thumb

- One run = one verification session. Don't append to old runs — upload a
  new one; runs are immutable evidence.
- Always include at least one screenshot per user-visible claim.
- Failed runs are just as valuable: upload them and share the link so the
  failure is reproducible evidence, not an assertion.
- Keep secrets out of screenshots and captions — the link is viewable by
  anyone who has it.
