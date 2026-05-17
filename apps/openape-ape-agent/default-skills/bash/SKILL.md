---
name: bash
description: When a task can't be done with the other curated tools (file.read, http.get, tasks.create, mail.list, etc.), use bash — runs any shell command on the agent host through the DDISA grant cycle.
metadata:
  openape:
    requires_tools: [bash]
---

# Shell access via ape-shell

## What this is

The `bash` tool spawns `ape-shell -c '<cmd>'` on the agent host. `ape-shell` is the human owner's interactive shell wrapper — every command goes through the OpenApe DDISA grant cycle:

- Auto-approved if a YOLO scope matches (owner has pre-approved this command pattern)
- Otherwise the owner gets a push notification on their phone with the exact command to approve or deny
- Approval takes ~3–15s typically; budget is 5min before the call times out

You run as the agent's hidden macOS user, so the filesystem and network you see are what *that* user sees — already jailed.

## When to prefer bash over a curated tool

Curated tools (time.now, http.get, file.read, tasks.list, mail.list) are **always preferred** when they apply:

- Faster (no grant cycle)
- Structured JSON returns instead of stdout parsing
- Lower risk score (visible to the owner in troop UI)

Reach for `bash` when:

- The curated tool doesn't cover the case (e.g. `git status`, `iurio cases search`, `o365-cli mail trash <id>`)
- You need to chain commands with pipes / loops / redirects
- You need an auth header the deny-list strips (e.g. `curl -H 'Authorization: …'`)

## Patterns

Read system info:

```
bash({ "cmd": "uname -a && uptime" })
```

Run a CLI:

```
bash({ "cmd": "ape-tasks list --status open,doing --json" })
bash({ "cmd": "iurio cases search 'foo'" })
```

Quote-heavy commands — wrap in single-quotes outside, escape inside:

```
bash({ "cmd": "find ~/Downloads -name '*.pdf' -mtime -7 -exec ls -lh {} +" })
```

Long-running command — use the `timeout_ms` param (default 5 min):

```
bash({ "cmd": "pnpm test", "timeout_ms": 180000 })
```

## Anti-patterns

- **Don't** use `bash date` for the time — call `time.now` (in-process, no grant).
- **Don't** use `bash cat ~/notes.md` for a $HOME read — call `file.read` (no grant).
- **Don't** retry a denied/timed-out approval automatically — the owner saw the prompt and chose. Surface the timeout clearly and ask what they'd like to do.
- **Don't** chain destructive commands in one call (`rm -rf … && …`). One destructive command per approval so the owner can decide each.

## Response shape

```json
{
  "stdout": "...",
  "stderr": "...",
  "exit_code": 0,
  "timed_out": false
}
```

Non-zero `exit_code` means the command failed — read `stderr` and decide whether to retry with a corrected command, surface the error to the user, or ask for guidance. **Don't** pretend it succeeded.
