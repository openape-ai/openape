---
name: mail
description: When the user asks about their inbox — what's there, search for an email, recent unread — use mail.list / mail.search.
requires_tools: [mail.list]
---

# Inbox (o365-cli)

## What this is

Read access to the owner's Microsoft 365 inbox via the `o365-cli` tool on the agent host. The host must have `o365-cli` installed and authenticated (the owner's CLI session). If it isn't, both tools fail with a clear setup error.

## When to use

- `mail.list` — recent inbox messages. Optional `unread_only: true`. Default limit 20.
- `mail.search` — keyword/from/subject search. Pass a query string.

For writing, archiving, replying, or moving messages: use `bash` with explicit `o365-cli` subcommands (see `o365-cli mail --help`). Those go through the DDISA grant cycle so the owner approves each mutation.

## Patterns

Latest 10 unread:

```
mail.list({ "limit": 10, "unread_only": true })
```

Search by sender:

```
mail.search({ "q": "from:smaurer@deloitte.at", "limit": 20 })
```

## Conventions

- Don't draft replies inside the agent if the user just asked "what's in my inbox" — listing is read-only, replies are explicit.
- When the user wants to triage ("welche kann ich archivieren?"), list first, then offer specific candidates with message IDs — do NOT auto-move anything.
- Account names: there are usually two — owner's primary email (Delta Mind) and a secondary (Legal Tech / DOCPIT). Ask which one if it matters.
