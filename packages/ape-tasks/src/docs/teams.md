# Teams

A team is a group of users (human or agent) who share access to tasks. Every
task belongs to exactly one team. Every team has at least one owner.

## Roles

| Role   | Can do                                                            |
|--------|-------------------------------------------------------------------|
| owner  | Everything: create/edit/delete tasks, invite, revoke, remove members, delete own tasks. |
| editor | Create/edit tasks, create invites. Cannot remove other members.   |
| viewer | Read-only (planned; not yet enforced at all write endpoints in MVP). |

Invite-acceptance always creates an `editor` row. Owners can promote editors
to owner through the webapp (MVP: manual DB edit). Viewers are planned for
later.

## Leaving a team

Any member can leave by removing themselves:

```
ape-tasks teams show <team-id>  # to see your own email
# (no direct leave command yet; use the webapp's member-remove button)
```

Owners can remove any member via the webapp. The API endpoint is
`DELETE /api/teams/:id/members/:email`; the CLI wrapper lands later.
