# Error reference

All API errors follow this JSON shape:

```json
{ "title": "<human message>", "detail": "<optional longer explanation>" }
```

The CLI prints `title` to stderr and exits non-zero. Use `--json` on the
failing command to see the full payload.

## 400 Bad Request
Missing required field, invalid `--duration`, invalid `--type`, bad date
(must be YYYY-MM-DD), or body too long. Fix the input and retry.

## 401 Unauthorized
No valid session. Run `apes login <email>` once on this device — the shared
apes session covers ape-timetrack. SP-tokens are cached and auto-refreshed.

## 403 Forbidden
Authenticated but not allowed. Common causes:
- Not a member of the company/project.
- Company *manager* trying to log time (managers are read-only reporting).
- Project *member* trying to view/edit another user's entry.
- Non-owner trying to manage a company, or rename/archive a project without
  being company owner or project manager.

## 404 Not Found
The company/project/entry does not exist or is archived/soft-deleted.

## 410 Gone
Invite-specific: expired, revoked, or out of uses. Ask the inviter for a
fresh URL (`companies invite` / `projects invite`).

## 5xx Server
Service unavailable. Retry with backoff. If persistent, file a bug noting
the `--endpoint` used.
