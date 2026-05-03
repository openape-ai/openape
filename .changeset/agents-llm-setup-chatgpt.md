---
"@openape/apes": minor
---

Add `apes agents llm setup chatgpt` and `apes agents llm unsetup` subcommands. Setup installs a per-machine litellm proxy (Python venv) at `~/.local/share/apes/llm/chatgpt/`, walks the user through the ChatGPT-Subscription OAuth device-code flow, applies the upstream-pending response.output_item.done patch, and bootstraps a launchd plist so the proxy auto-starts on login. Unsetup is the idempotent reverse. Lays the groundwork for `apes agents spawn --bridge=chatgpt` (separate PR).
