---
'@openape/apes': patch
---

Fix `apes agents sync` rejecting every spawned agent with "expected an agent+name+domain@idp address". The validator was checking `email.startsWith('agent+')` but the IdP's `deriveAgentEmail` produces `<safeName>-<ownerHash>+<owner-local>+<owner-domain>@<idp-host>` — the `+` is embedded, not the prefix. Switch to checking for `+` anywhere (the subaddressing distinguishes agents from humans). Same fix to `agentNameFromEmail` parser.
