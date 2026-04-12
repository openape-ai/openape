---
'@openape/apes': minor
---

feat(apes): configurable notification command when grant approval is pending

When `ape-shell` (or `apes run --shell`) enters the grant approval wait loop, it now optionally runs a user-configured notification command so the user knows they need to approve. This is especially important when an AI agent (e.g., openclaw) spawns `ape-shell -c "<cmd>"` and the user is only reachable via Telegram, a TUI, or another out-of-band channel — previously the agent just silently blocked.

**Only fires when actually waiting.** Reused timed/always grants that don't require new approval do NOT trigger a notification.

Configuration via `~/.config/apes/config.toml`:

```toml
[notifications]
pending_command = "curl -sS 'https://api.telegram.org/bot$TOKEN/sendMessage' -d chat_id=$CHAT -d text='⏸ {command}\n{approve_url}'"
```

Or per-invocation via env var (takes precedence):

```bash
APES_NOTIFY_PENDING_COMMAND="osascript -e 'display notification \"{command}\" with title \"apes\"'" ape-shell -c "ls"
```

Template variables: `{grant_id}`, `{command}`, `{approve_url}`, `{audience}`, `{host}`. All values are shell-escaped via `shell-quote` to prevent injection.

The notification subprocess runs fire-and-forget (detached, unref'd, 10-second kill timeout) so it never blocks the grant flow.
