---
'@openape/apes': patch
---

Move troop sync plist from `~/Library/LaunchAgents/` (gui/<uid> domain) to `/Library/LaunchDaemons/` (system domain) with a `UserName` key — same pattern the bridge has always used. Hidden service accounts (IsHidden=1) never log in graphically, so their per-user launchd domain doesn't exist; `launchctl bootstrap gui/<uid>` was failing with "Domain does not support specified action" for every spawned agent. System-domain bootstrap doesn't need a user session — launchd runs the daemon as the agent uid via `UserName`.

Side benefit: removes the `su -c '...'` wrapper, so no more shell-quoting issues with `set -u` inside the inner shell.
