# pr.json — manifest format

A pull request is a directory containing one `pr.json` plus, optionally, a
`diff.patch` file and any images the description embeds. `ape-pr upload <dir>`
sends the manifest and uploads the images.

```json
{
  "title": "fix: reply composer grows with content",
  "description": "The reply `<textarea>` was locked to two rows.\n\nGrows with content now. See the [issue](https://git.openape.ai/x/issues/42).\n\n![before](desc/before.png)",
  "author": "scribe",
  "authorAct": "agent",
  "branch": "fix/reply-box-height",
  "baseSha": "a1b2c3d",
  "headSha": "9f8e7d6",
  "diff": "diff --git a/...\n--- a/...\n+++ b/...\n@@ ..."
}
```

## Fields

| Field | Required | Notes |
|---|---|---|
| `title` | yes | PR headline (≤300 chars). |
| `description` | no | Markdown, shown above the diff. May embed `http(s)` links and images (relative paths uploaded as assets). |
| `author` | no | Free-text author shown in the header (defaults to the caller). |
| `authorAct` | no | `human` \| `agent` (default `agent`). |
| `branch` | no | Source branch label. |
| `baseSha` / `headSha` | no | Commit refs, shown in the header. |
| `diff` | yes* | Raw unified diff (`git diff` output). *If omitted, the CLI reads `diff.patch` from the directory. |

## The diff

Send the raw output of `git diff <base>...<head>` — the same text `git`
prints. It is rendered client-side (split or unified, syntax-highlighted), so
no pre-processing is needed. File counts and `+`/`-` totals are derived from
the patch.

The easiest pipeline:

```
git diff main...HEAD > out/diff.patch
# write out/pr.json (without a "diff" field)
ape-pr upload ./out
```

## Images

Any `.png` / `.jpg` / `.jpeg` / `.webp` / `.gif` in the directory is uploaded
(max 8 MB each) and addressable from the markdown description by its relative
path, e.g. `![before](desc/before.png)`.

## Semantics

- Markdown is rendered with raw HTML escaped — `<script>` etc. never executes;
  links must be `http(s)`.
- A PR starts `pending`. Once a human submits a review it becomes `reviewed`;
  poll the verdict with `ape-pr status <slug>`.
