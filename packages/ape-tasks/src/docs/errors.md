# Error reference

All API errors follow this JSON shape:

```json
{ "title": "<human message>", "detail": "<optional longer explanation>" }
```

The CLI prints `title` to stderr and exits non-zero.

## 400 Bad Request
Missing required field, invalid duration (`--expires-in`), invalid status,
body too long. Fix the input and retry. Use `--json` on the failing command
to see the full error.

## 401 Unauthorized
No valid session. Run `ape-tasks login <email>` and paste a fresh token.
Tokens expire after 30 days.

## 403 Forbidden
You are authenticated but not allowed. Common causes:
- You are not a member of the team.
- Your role is `viewer` and the operation requires `editor` or `owner`.
- You are trying to delete a task you do not own on a team you do not own.

## 404 Not Found
The resource does not exist, or it is soft-deleted. For tasks, check with
`ape-tasks list`; a task that was deleted will not appear.

## 410 Gone
Invite-specific. The invite has expired, been revoked, or run out of uses.
Ask the inviter to generate a new URL.

## 5xx Server
Service is unavailable. Retry with backoff. If persistent, file a bug with
the request id (coming in a later version) and the `--endpoint` you used.
