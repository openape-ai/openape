---
name: file
description: When the user asks you to read, write, or check a file in your home directory, use the file.read / file.write tools — they're $HOME-jailed and safer than bash cat.
requires_tools: [file.read]
---

# Files in $HOME

## Jail

Both tools are restricted to the agent's `$HOME` directory:

- `path` is resolved relative to `$HOME` (`~/` prefix accepted, or plain `notes.md`)
- `..` segments that would escape `$HOME` are rejected
- 1 MB cap per read/write — anything bigger gets truncated (read) or rejected (write)

For files **outside** `$HOME` (e.g. `/etc/...`, another user's directory), use `bash` with `cat`/`tee` — that goes through the DDISA grant cycle so the owner can approve broad-fs reads explicitly.

## Patterns

Read a JSON config:

```
file.read({ "path": "~/.openape/agent/agent.json" })
```

Append a note (read-modify-write — there's no `file.append`):

```
const r = file.read({ "path": "notes.md" })
file.write({ "path": "notes.md", "content": r.content + "\n- new line\n" })
```

## Conventions

- Paths in user prompts ("save this to notes.md") → relative to `$HOME`. Don't prefix with `/Users/...`.
- Binary files don't round-trip via these tools (UTF-8 only). Use `bash` for non-text I/O.
