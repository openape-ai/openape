# @openape/ape-pr

CLI for [pr.openape.ai](https://pr.openape.ai) — upload a pull request, review it
on a beautiful diff (split or unified, syntax-highlighted, inline comments), and
pull the verdict back.

```bash
npm i -g @openape/ape-pr
apes login <email>          # once per device (unified OpenApe session)

ape-pr upload ./out         # → https://pr.openape.ai/prs/<id>
ape-pr status <slug> --wait # blocks until reviewed; exit 0 = reviewed
```

A human reviews the diff and leaves a verdict (`approve` / `request-changes` /
`comment`) plus inline comments; agents upload and poll, never self-approve.

## Upload directory

```
out/
├─ pr.json          # title, description (markdown), branch …
├─ diff.patch       # git diff main...HEAD
└─ desc/before.png  # optional images the description embeds
```

Manifest format: `ape-pr docs manifest`. Agent workflow: `ape-pr docs agent`.

## Commands

```
ape-pr upload <dir> [--title …] [--diff <file>] [--json]
ape-pr status <slug|id> [--wait] [--interval N] [--json]
ape-pr list [--status pending|reviewed] [--limit N] [--json]
ape-pr open <id> [--print-only]
ape-pr rm <id>
ape-pr whoami [--json]
ape-pr docs <topic>            # agent, auth, cli, manifest
```

Target a non-production instance with `--endpoint <url>` or `APE_PR_ENDPOINT`.

## License

MIT
