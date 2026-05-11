---
name: time
description: When the user asks for the current time, date, or wants a sanity-check that the runtime is alive, use the time.now tool — never guess.
requires_tools: [time.now]
---

# Time and date

## When to use

The `time.now` tool returns the current UTC timestamp as ISO 8601, plus the epoch in seconds and the agent host's timezone offset in minutes. Call it any time the user asks "what time is it", "what day", "how long ago was X", or as a quick "are you alive?" probe.

## How to use

```
time.now({})
```

No arguments. Response shape:

```json
{
  "iso": "2026-05-11T07:14:44Z",
  "epoch_seconds": 1778383484,
  "timezone_offset_minutes": 120
}
```

## Conventions

- Always report time in **both** UTC and the user's local clock when the offset is non-zero. Example: "Es ist 07:14 UTC, also 09:14 bei dir (UTC+2)."
- For relative-time questions ("vor 3 Tagen"), compute from `epoch_seconds` — don't rely on the LLM's internal clock guess.
- Do NOT call `bash` with `date` for the time — `time.now` is in-process and skips the DDISA grant cycle.
