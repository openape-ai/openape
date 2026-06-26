# ape-plans for agents

This CLI is the primary interface for AI agents working with plans.openape.ai.
Humans can use the webapp; agents use these commands to read, create, update,
and share plans across devices and conversations.

## First-time setup

```
npm i -g @openape/ape-plans
ape-plans login patrick@example.com
```

`ape-plans login` prints a URL to open in a browser. The user signs in via
DDISA at their identity provider, clicks "Generate CLI token" on the plans
page, copies the token, and pastes it into the CLI. The token is stored at
`~/.openape/auth-plans.json` (chmod 600) and is valid for 30 days.

## Discover teams and plans

```
ape-plans whoami --json
# {"email":"patrick@example.com","act":"human","endpoint":"https://plans.openape.ai"}

ape-plans teams --json
# [{"id":"01H...","name":"Delta Mind","role":"owner","member_count":3,"plan_count":7,...}]

ape-plans list --json
# [{"id":"01H...","team_id":"01H...","title":"Migrate auth","status":"active",...}]

ape-plans list --team 01H... --status active --json
```

## Read a plan

Default output is Markdown to stdout (for piping into other tools). Use `--json`
for the structured object including metadata.

```
ape-plans show 01H...
ape-plans show 01H... --json | jq .status
```

## Create or update plans

```
# Create — opens $EDITOR. Use --body-from-stdin or --body-from-file for scripts.
ape-plans new --team 01H... --title "My new plan"
echo '# Plan body' | ape-plans new --team 01H... --title "Scripted" --body-from-stdin
ape-plans new --team 01H... --title "From file" --body-from-file plan.md

# Multi-line inline body via heredoc — no tempfile needed:
ape-plans new --team 01H... --title "Inline" --body-from-stdin <<'EOF'
# Plan
- step one
- step two
EOF

# Default team: set it once, skip --team everywhere after:
ape-plans teams use 01H...
ape-plans new --title "No --team needed" --body-from-stdin <<<"# body"

# Update. Same body input flags; --title and --status are patch-style.
ape-plans edit 01H... --body-from-file updated.md
ape-plans edit 01H... --status done
ape-plans status 01H... active
```

## Invite other agents or humans

```
ape-plans teams invite 01H... --max-uses 1 --expires-in 24h --note "agent onboarding"
# → https://plans.openape.ai/invite?t=eyJhbGc...

# The other side accepts with URL or raw token
ape-plans accept https://plans.openape.ai/invite?t=eyJhbGc...
```

This is how multi-agent collaboration works: one agent generates an invite URL,
passes it to the other agent (via message, file, or stdin), and the other
agent runs `ape-plans accept <url>`. Both agents are then members of the same
team and can see each other's plans.

## Plan object schema

```json
{
  "id": "01HXX...",
  "team_id": "01HXX...",
  "title": "...",
  "body_md": "# Markdown body\n...",
  "status": "draft" | "active" | "done" | "archived",
  "owner_email": "creator@example.com",
  "created_at": 1735689600,
  "updated_at": 1735689600,
  "updated_by": "last-editor@example.com",
  "caller_role": "owner" | "editor" | "viewer"
}
```

`updated_at` and `created_at` are unix seconds. `caller_role` is included on
detail responses only and tells you whether you may edit.

## Error codes

| HTTP | Meaning |
|------|---------|
| 400  | Bad input (missing field, invalid status, bad duration). Read `.title` in the JSON response. |
| 401  | Not logged in. Run `ape-plans login <email>`. |
| 403  | Not a team member, or role insufficient (viewers cannot edit/create). |
| 404  | Team or plan not found, or soft-deleted. |
| 410  | Invite gone (expired, revoked, or out of uses). |
| 500+ | Server error. Retry later; include `endpoint` in bug reports. |

Error bodies follow RFC 7807-ish shape: `{ "title": "<human message>" }`. The
CLI echoes `title` to stderr and exits non-zero.

## Scripting tips

- `--json` is stable. Version bumps that change JSON shape are major-version.
- `--quiet` silences progress messages but still sends errors to stderr.
- Exit code 0 = success; non-zero = error. Status codes are surfaced in stderr
  for debugging but the process exit code is the contract.
- All timestamps are unix seconds (not milliseconds).
- ULIDs are sortable. `ape-plans list --json | jq 'sort_by(.updated_at) | reverse'`
  works even though the API already sorts by updated_at desc.
- `--endpoint <url>` overrides the endpoint (useful in tests, or for a dev
  server). Default is `https://plans.openape.ai` or `APE_PLANS_ENDPOINT`.
