---
'@openape/cli-auth': patch
'@openape/chat-bridge': patch
---

Fix bridge crash-loop "auth.json missing 'owner_email'" after `apes login`.

- `@openape/cli-auth`: `saveIdpAuth` now merges with existing fields instead of overwriting wholesale. `apes login` (called from the bridge's `start.sh` on every daemon boot) used to silently drop `owner_email` written by `apes agents spawn`, leaving the bridge in a fatal restart loop until the auth.json was manually re-stamped. The merge preserves any unknown keys in the file across logins.
- `@openape/chat-bridge`: `readAgentIdentity` falls back to `OPENAPE_OWNER_EMAIL` env var when `owner_email` is missing from auth.json, so an old agent (spawned before the Phase A migration) can be unblocked by adding one line to its launchd plist.
