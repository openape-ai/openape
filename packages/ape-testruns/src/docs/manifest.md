# testrun.json — manifest format

A test run is a directory containing one `testrun.json` plus the screenshots
it references. `ape-testruns upload <dir>` sends the manifest, then uploads
every referenced screenshot from the same directory.

```json
{
  "title": "Login flow E2E",
  "project": "my-app",
  "summary": "Full login round-trip against the staging deploy. **All green.**",
  "startedAt": "2026-06-12T10:00:00Z",
  "finishedAt": "2026-06-12T10:03:21Z",
  "tests": [
    {
      "id": "login",
      "title": "User can log in",
      "description": "Email + password login lands on the dashboard.",
      "status": "passed",
      "steps": [
        {
          "title": "Open landing page",
          "caption": "The page shows the email field **above the fold**.",
          "shot": "login/01-landing.png",
          "status": "passed"
        },
        {
          "title": "Submit credentials",
          "caption": "Submitting redirects to `/dashboard`.",
          "shot": "login/02-dashboard.png"
        }
      ]
    },
    {
      "id": "logout",
      "title": "User can log out",
      "status": "failed",
      "error": "Expected redirect to `/` but stayed on `/dashboard`.\n\n```\nTimeoutError: waiting for navigation\n```",
      "steps": [
        { "title": "Click logout", "shot": "logout/01-stuck.png", "status": "failed" }
      ]
    }
  ]
}
```

## Fields

| Field | Required | Notes |
|---|---|---|
| `title` | yes | Run headline (≤300 chars). |
| `project` | no | Free-text project name shown above the title. |
| `summary` | no | Markdown, shown under the header. |
| `startedAt` / `finishedAt` | no | ISO 8601; renders a duration when both present. |
| `tests[]` | yes | 1–200 tests. |
| `tests[].id` | yes | Unique per run (kebab-case recommended). |
| `tests[].title` | yes | |
| `tests[].description` | no | Markdown. |
| `tests[].status` | yes | `passed` \| `failed` \| `skipped`. |
| `tests[].error` | no | Markdown — error message / stack excerpt for failures. |
| `tests[].steps[]` | no | ≤100 steps per test. |
| `steps[].title` | yes | |
| `steps[].caption` | no | Markdown (inline) — what the screenshot shows. |
| `steps[].shot` | no | Relative image path: segments of `[A-Za-z0-9._-]`, ending in `.png`/`.jpg`/`.jpeg`/`.webp`/`.gif`. Max 8MB per file. |
| `steps[].status` | no | Marks a single step as failed in the report. |

## Semantics

- The run status is aggregated server-side: any failed test → `failed`,
  else any passed → `passed`, else `skipped`.
- Markdown is rendered with raw HTML escaped — `<script>` etc. never executes.
  Links must be `http(s)`.
- Steps without `shot` are fine (text-only steps). A `shot` whose file is
  missing at upload time renders as text-only; re-upload to fix.
- Screenshot bytes are stored by path; re-uploading the same run directory
  creates a NEW run with a new link (runs are immutable evidence).

## Writing style for captions

Captions are product documentation for a reader who sees only the report:
present tense, describe what the reader can see and what it proves.
Good: "The dashboard greets the user by name — the session is live."
Avoid test-speak: "assert that element #user-name is visible".
