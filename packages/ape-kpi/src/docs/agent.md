# ape-kpi — agent reference

You are an agent finishing a duty (mail triage, task scan, …). Report your
numbers as the LAST step of the duty — the dashboard and the user's morning
mail are built from exactly these pushes.

## Auth

The device must have run `apes login <email>` once. ape-kpi exchanges that
session against dashboard.openape.ai automatically. The server derives
`owner` (the user you act for) and `source` from the token — you cannot and
must not set them.

## Commands

```
ape-kpi push <key> <value> [--scope <path>] [--unit <u>] [--detail <md> | --detail-file <f>] [--link <https-url>] [--json]
ape-kpi list [--latest] [--scope <path>] [--since <ISO|unix-ms>] --json
ape-kpi whoami --json
```

- `key`: metric name, dot-hierarchical — `mail.docpit.wichtig`, `tasks.due`.
- `value`: finite number.
- `--scope`: grouping path (slash-hierarchical) — `delta-mind`, `delta-mind/mail`.
  Defaults to `general`. The app does not interpret it; it only groups.
- `--detail` / `--detail-file`: Markdown shown behind the number (e.g. the three
  important mails, fully written out). ≤ 64 KB.
- `list --latest`: newest row per (scope, key) — what the dashboard shows.

## Rules

- Push at the END of a duty, once, with the final numbers.
- **The number and the detail list must never contradict**: if `value` is 17
  and you list the top 3, the detail MUST end with a rest line — `+14 weitere`.
  A reader who counts 3 items under a 17 stops trusting the whole board.
- One push per metric — don't batch unrelated metrics into one detail.
- The detail is user-facing Markdown: write it for the human reading their
  morning mail, not as a log dump.
- **Link everything that has a URL.** Pass `--link` with the source system's
  URL (task board, mailbox, repo) — the dashboard links the card title and its
  rest line there. Inside the detail, make every line a Markdown link where the
  item has one: `[Betreff](https://outlook.office.com/mail/inbox/id/<urlencoded
  message_id>)` for M365 mails, the team board URL for tasks, the PR URL for
  PRs. A line without a link is a dead end for the reader.
