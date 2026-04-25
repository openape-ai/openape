---
'@openape/cli-auth': patch
---

Drop unused `@openape/core` dependency. The lib only uses `ofetch` and Node built-ins; `@openape/core` was inherited from the apes scaffold but never imported. Removing it unblocks downstream installs that previously failed because the package was published with `"@openape/core": "workspace:*"` literally (npm publish doesn't substitute the workspace protocol — only `pnpm publish` does, and the bootstrap publish accidentally went through plain `npm`).
