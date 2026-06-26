---
"@openape/apes": patch
---

fix(cli): `apes run --as <user>` works off-Linux again

`resolveRunAsTarget` treated agent-shaped names (incl. the system user `root`,
which matches the agent-name regex) as managed agent users and called the
Linux-only `getHostPlatform()`, so `apes run --as root -- <cmd>` failed on
macOS with "unsupported host platform". The agent-name → prefixed-OS-username
mapping only matters where managed agent users exist (Linux nests); on other
hosts the name now passes through unchanged, so the plain escapes/grant flow
runs as before. The Linux-only guard stays in force for the nest user
lifecycle (agents spawn/destroy, supervisor install).
