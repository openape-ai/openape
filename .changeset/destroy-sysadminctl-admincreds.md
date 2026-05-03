---
"@openape/apes": patch
---

Fix: `apes agents destroy` no longer hangs ~5min and fails with `eUndefinedError -14987` from `DSRecord.m`.

Root cause: the teardown script ran inside `escapes`' setuid-root context, which has no audit/PAM session attached (`AUDIT_SESSION_ID=unset`). Plain `sysadminctl -deleteUser` and `dscl . -delete` both made an implicit "is current session admin?" check via opendirectoryd; with no session bound, the lookup hung 5min and exited `-14987`.

Fix: pass `-adminUser/-adminPassword` to `sysadminctl` so it authenticates against DirectoryService directly instead of probing the session. The local admin password is collected from `APES_ADMIN_PASSWORD` (preferred) or a silent prompt, then piped via stdin into the teardown script — never as an argv element (would leak via `ps` and the escapes audit log). With this change the user record delete completes in ~1s.
