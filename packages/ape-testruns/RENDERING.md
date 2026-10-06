# Local report rendering

`ape-report-render` reads UTF-8 JSON (maximum 1 MiB) and writes a complete HTML file.
It uses no network or authentication. `--json` prints a receipt with `published:false`;
errors go to stderr with exit 2. An existing output needs explicit `--overwrite`.

## Test Runs

Use the existing `testrun.json` contract (`ape-testruns docs manifest`). Each test
requires a unique `id`, `title`, and `status` (`passed`, `failed`, `skipped`). Steps
may include `title`, `status`, `caption` and `shot`. Referenced PNG/JPEG/GIF/WebP
files must remain within the manifest directory, including resolved symlinks.
Each image is at most 8 MiB; the complete HTML is at most 20 MiB. Resizing is an
explicit author step: the renderer never silently drops evidence.

Optional `--commit`, `--command`, `--environment`, and `--next-step` fields describe
actual verification. Missing context is displayed as missing, never inferred.
Failure details appear first. All recorded outcomes and skipped checks remain visible.
Screenshots must be personally inspected before publication as acceptance evidence.
Use the installed `examples/testrun.json` only as a synthetic starting point.

## Plans: `openape.plan/1`

Required top-level fields:

| Field | Value |
| --- | --- |
| `schema` | `openape.plan/1` |
| `title`, `goal` | Nonempty text |
| `status` | `draft`, `active`, `done`, `archived` |
| `milestones` | Nonempty list described below |

Optional text: `project`, `owner`, `date`, `context`. Optional lists:

| Field | Item fields |
| --- | --- |
| `decisions` | `title`, `description`, `status` (`proposed`, `accepted`, `rejected`); optional `by`, `date` |
| `milestones` | `title`, `goal`, `status` (`planned`, `active`, `done`, `blocked`), nonempty `acceptance` text list; optional `steps` text list, `proof`, `rollback` |
| `scope`, `nonGoals`, `verification` | Text |
| `risks` | `title`, `mitigation` |
| `changelog` | `date`, `text` |
| `links` | `title`, `url` (absolute HTTPS, no credentials) |

Optional `approval` requires `by`, `date` and `reference`. Record the real owner
statement and exact approved version/digest. An active or done status alone never
records approval. Each list permits at most 200 entries; each text field at most
20,000 characters (titles: 300). Unknown fields fail before rendering. See `examples/plan.json` for a complete input.

Rich descriptions support sanitized Markdown. Raw HTML is escaped, image Markdown
is retained as a text reference, and unsafe links are removed. Plain labels and list items are escaped.
The normalized source is retained in inert `application/json`, with script-closing
characters escaped. Existing output files and remote publications remain unchanged
when input validation fails.

## Publish and revise

```sh
ape-report-render plan plan.json plan.html
ape-reports preview plan.html --check
ape-reports publish plan.html --team TEAM_ID --category Plans --key plan-v1
ape-reports show DOCUMENT_ID --json
# Edit the local JSON, preserving other authors' latest changes first.
ape-report-render plan plan.json plan.html --overwrite
ape-reports publish plan.html --document DOCUMENT_ID --expected-version 1 --key plan-v2
```

Retain the same key and bytes after an unknown publication outcome; query the
receipt before retrying. Use a new key only for a new, intentional version.
