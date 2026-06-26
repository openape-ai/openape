# CLI reference

```
ape-pr upload <dir>      Upload a run directory, print the share link.
  --manifest <file>            Manifest path (default <dir>/pr.json)
  --title / --project / --summary   Override manifest fields
  --json                       Print { id, slug, url, status, uploaded, missing }

ape-pr list              Your runs, newest first.
  --limit <n>                  Default 50, max 200
  --json

ape-pr show <id>         One run as JSON (manifest, uploaded assets, URL).
ape-pr open <id>         Open the public report in a browser.
  --print-only                 Just print the URL
ape-pr rm <id>           Delete a run; its share link 404s afterwards.
ape-pr whoami            Show identity as seen by the server.
ape-pr logout            Drop the cached SP token (apes session untouched).
ape-pr docs <topic>      agent | auth | cli | manifest
```

Global:

- `--endpoint <url>` — target another instance (e.g. http://localhost:3006).
- `APE_PR_ENDPOINT` — same as env var.

Exit codes: 0 success, 1 any error (message on stderr).
stdout discipline: `upload` prints exactly the URL (or `--json` object) —
safe to capture in scripts.
