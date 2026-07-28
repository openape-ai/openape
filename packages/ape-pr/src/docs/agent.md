# ape-pr — agent reference

You opened a pull request; now a human needs to review it. pr.openape.ai turns
a unified diff + a JSON manifest into a review surface: a beautiful diff (split
or unified), the markdown description, and a place for the reviewer to leave a
verdict and inline comments. You poll the verdict back and act on it.

## End-to-end workflow

1. **Produce the diff and description.**

   ```
   out/
   ├─ pr.json          # title, description (markdown), branch, …
   ├─ diff.patch       # git diff main...HEAD
   └─ desc/before.png  # optional images the description embeds
   ```

   Write the diff with `git diff <base>...<head> > out/diff.patch`.
   Manifest format: `ape-pr docs manifest`.

2. **Upload:**

   ```
   ape-pr upload ./out
   ```

   stdout is exactly one line: the review URL. Progress goes to stderr.
   Add `--json` for `{ id, slug, review_url, files, additions, deletions }`.
   Keep the `slug` — it is how you poll the verdict.

3. **Wait for the verdict.**

   ```
   ape-pr status <slug> --wait        # blocks until reviewed, exit 0
   ape-pr status <slug> --json        # one check; exit 3 while pending
   ```

   The reviewed payload is `{ state, verdict, body, comments[] }` where
   `verdict` is `approve` | `request-changes` | `comment` and each comment has
   `{ path, line, side, body, image_path }`.

4. **Act on it.**
   - `approve` → merge.
   - `request-changes` → address each inline comment, push, upload a new PR.
   - `comment` → read the notes; usually iterate.

## Auth

One-time per device: `apes login <email>` (human approves via browser).
After that, ape-pr works headlessly — it exchanges the apes session for an SP
token automatically. `ape-pr whoami` verifies. Only a human reviewer can
submit a verdict; agents upload and poll.

## Commands

```
ape-pr upload <dir> [--title …] [--diff <file>] [--json]
ape-pr status <slug|id> [--wait] [--interval N] [--json]
ape-pr list [--status pending|reviewed] [--limit N] [--json]
ape-pr open <id> [--print-only]
ape-pr rm <id>                    # review link stops working
ape-pr whoami [--json]
ape-pr docs <topic>               # agent, auth, cli, manifest
```

`--endpoint <url>` on any command (or env `APE_PR_ENDPOINT`) targets a
non-production instance, e.g. local dev on http://localhost:3006.

## Rules of thumb

- One PR = one branch under review. After `request-changes`, push fixes and
  upload a fresh PR rather than mutating the old one.
- Put the *why* in the description and the *what* in the diff — the reviewer
  reads both.
- Keep secrets out of the diff, description, and images.
