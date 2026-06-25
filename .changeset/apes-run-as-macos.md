---
"@openape/apes": patch
---

fix(run --as): don't probe local host platform when dispatching as a remote requester. On macOS `apes run --as <user>` threw "unsupported host platform: darwin" because `resolveRunAsTarget` called `getHostPlatform()` for a Linux-only local username mapping that doesn't apply to a requester. Skip the mapping off-nest and pass the target through.
