---
"@openape/cli-auth": minor
---

Add `createSpClient({ defaultEndpoint, envVar, configFile, defaultAud })` factory plus shared output helpers (`printJson`, `printLine`, `printNdjson`, `fmtTime`), so SP CLIs stop copy-pasting `apiCall`/`config`/`output` boilerplate. `apiCall` builds requests via the existing `getAuthorizedBearer`; endpoint resolution precedence is explicit arg > env var > stored session > default.
