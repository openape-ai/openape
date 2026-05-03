# ape-chat — command reference

## Setup

```bash
apes login <email>          # once per device
ape-chat whoami             # verify
ape-chat rooms list         # see what you're in
ape-chat rooms use <id>     # set default room
```

## Commands

| Command | What it does |
|---|---|
| `whoami` | Show resolved identity from the IdP token |
| `rooms list` | List rooms the caller is a member of |
| `rooms create --name X --kind channel\|dm [--members a@b,c@d]` | Create a new room |
| `rooms info <id>` | Show one room's metadata |
| `rooms use <id>` | Persist a default room id |
| `rooms clear` | Forget the default room |
| `send "..."` `[--room <id>] [--reply-to <msg-id>]` | Post a message |
| `list` `[--room <id>] [--limit N] [--before <unix-s>]` | Show recent history |
| `watch` `[--room <id>] [--json]` | Stream live events via WebSocket |
| `members list` `[--room <id>]` | Members + roles |
| `members add <email>` `[--role member\|admin] [--room <id>]` | Invite (admins only) |
| `members remove <email>` `[--room <id>]` | Kick (admins only) |
| `docs <topic>` | Show embedded reference (topics: `agent`, `cli`) |

Every command supports `--json` for scripting.

## Endpoint override

Default: `https://chat.openape.ai`. Override per-shell with
`APE_CHAT_ENDPOINT=https://custom.host`. The current default is also
persisted in `~/.openape/auth-chat.json` (set by `rooms use` / future
configuration commands).

## Environment

| Variable | Purpose |
|---|---|
| `APE_CHAT_ENDPOINT` | Override the chat host |
| `APE_CHAT_ROOM` | Override the default room id |

## Exit codes

`0` on success, `1` on any error (including HTTP 4xx/5xx from chat).
