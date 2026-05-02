---
"@openape/apes": minor
---

apes: `apes agents spawn` can pre-install a Claude Code OAuth token

`apes agents spawn agent-x --claude-token sk-ant-oat01-…` (or `--claude-token-stdin` for the paranoid form) now writes the token to `~/.config/openape/claude-token.env` (chmod 600) under the new agent's HOME and adds source-lines to `.zshenv` and `.profile`. The agent can immediately run `claude -p "…"` without an interactive auth step — useful for unattended setups where you've already run `claude setup-token` once on your trusted machine and want to seed the agent with the resulting long-lived token.

Token shape is validated (`sk-ant-oat01-…` prefix) so a mistyped token errors out at spawn time instead of writing a useless string. Rotate by editing the env file in place; the rc-source lines stay stable.

`--claude-token` is visible to `ps`. Use `--claude-token-stdin` in scripts:

```
echo "$CLAUDE_CODE_OAUTH_TOKEN" | apes agents spawn agent-x --claude-token-stdin
```
