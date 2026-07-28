# Team invites

Invites are signed JWT URLs. Anyone with the URL can join the team until it
expires, is revoked, or runs out of uses.

## Create

```
ape-tasks teams invite <team-id> [--max-uses N] [--expires-in DUR] [--note "..."]
```

- `--max-uses`: 1–100 (default 5).
- `--expires-in`: `7d`, `24h`, `30m` syntax (default `7d`). Max 90d.
- `--note`: up to 200 chars; shown to the recipient on the invite page.
- `--json`: returns `{id, url, token, expires_at, max_uses, note}`.

Default output is the URL on stdout, followed by a human-readable summary on
stderr. Suitable for `INVITE_URL=$(ape-tasks teams invite <id>)`.

## Accept

```
ape-tasks accept <url-or-token>
```

Accepts both the full URL (`https://tasks.openape.ai/invite?t=...`) and the
raw token extracted from it. The caller joins as `editor` by default (team
owner can promote via the webapp later). Idempotent: already-members succeed.

## Inspect / revoke

```
ape-tasks teams invites <team-id>              # list active invites
ape-tasks teams revoke-invite <invite-id>      # revoke (JWT becomes invalid)
```

Revocation is instant — the next `accept` attempt returns 410 Gone. All
`accept` endpoints also check the DB row, so a screenshot of a revoked URL
cannot be used retroactively.

## Security

- The JWT contains `tid` (team id), `inv` (inviter email), `kid` (DB row id),
  and `exp`. It is signed with `NUXT_INVITE_SECRET` on the server. Rotating
  that secret invalidates all outstanding invites.
- The public `GET /api/invites/:token` endpoint is the only unauthenticated
  API. It returns the team name and inviter so the recipient can decide
  whether to join, but not the full team contents.
- `POST /api/invites/accept` is rate-limitable at the nginx layer (plan: 10
  req/min/IP). This is not enforced by the app itself in MVP.
- Screenshots of invite URLs leak the full token. Prefer short `--expires-in`
  and low `--max-uses` for sensitive teams.
