---
name: tasks
description: When the user wants to see, create, or schedule a task/reminder/wiedervorlage on their personal task list, use tasks.list / tasks.create.
metadata:
  openape:
    requires_tools: [tasks.list]
  openclaw:
    # The bash escape-hatch path uses ape-tasks; surface it as a soft
    # dependency so on a host without ape-tasks the LLM is told this
    # skill doesn't apply.
    requires:
      bins: [ape-tasks]
---

# Personal tasks (ape-tasks)

## What this is

The owner's personal task list at https://tasks.openape.ai — same one their `ape-tasks` CLI on Mac and the iOS app use. You're allowed to read it and add to it via the `tasks.list` and `tasks.create` tools.

## When to use

Use `tasks.create` whenever the user asks for any of:

- "Reminder me to X tomorrow"
- "Wiedervorlage in 2 Tagen"
- "Add to my todo: …"
- "Schedule X for next week"

Use `tasks.list` when they ask "what's on my list", "any open tasks", "remind me what's due".

## Create — parameters

```
tasks.create({
  "title": "<short title>",
  "notes": "<optional longer body>",
  "priority": "low" | "med" | "high",      // default med
  "due_at": "<ISO 8601 or relative: +2h | +1d | tomorrow 9am>"
})
```

For wiedervorlage (mail-eskalation) the owner has a separate flow via `ape-tasks new --remind-at ...` — that path triggers email reminders. If the user wants a *reminder* (not just a todo), prefer:

```
bash({ "cmd": "ape-tasks new --title '...' --remind-at '+2d' --context-summary '...' --context-url '...'" })
```

…because the CLI has more knobs than the tool exposes (assignee, remind-at, context-url).

## Conventions

- Always convert relative dates from the user prompt to an absolute date in your response: "in 2 Tagen" → "am 13. Mai 2026".
- Don't create duplicate tasks — `tasks.list` first if the user might have one already.
- If the user asks for "remind me on …" and you only have `tasks.create`, set `due_at` and explain that the **list** will surface it, but no push notification fires unless they used `ape-tasks --remind-at`.
