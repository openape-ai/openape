---
'@openape/nest': minor
---

Remove the in-daemon bridge supervisor. Bridge-process lifecycle is now exclusively delegated to the per-agent system-domain launchd plist that `apes agents spawn --bridge` installs into `/Library/LaunchDaemons/`. The supervisor was created on the assumption that it would *replace* the launchd plists, but the spawn flow kept installing both — they raced each other every minute, and the supervisor's children inherited the human-user PATH which doesn't include the agent's `~/.bun/bin`, so the supervisor child crashlooped on `Command not found: openape-chat-bridge` while the launchd-domain bridge ran fine. Each crashloop produced an auto-approved YOLO grant which fired a notification, drowning the human in approval pings every ~15 seconds. Removing the supervisor is the correct fix per the architecture decision: launchd is already the right OS-level supervisor on macOS.
