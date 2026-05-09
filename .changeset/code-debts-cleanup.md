---
'@openape/apes': patch
---

Three small code-debt fixes:

1. **`apes grants delegate --approval`** now actually works. The CLI was sending `approval: <value>` in the request body but the server reads `grant_type`. Result: every delegation got `grant_type: 'once'` regardless of `--approval timed|always`. Now the body uses the wire name `grant_type`. (CLI flag stays `--approval` for UX continuity — that's the term humans see in the IdP grant-approval UI.)

2. **`registerAgentAtIdp` audit logs**. When an agent enrolls, the code paths `tryDelegatedEnrollToken` either succeeds (logs `[agent-bootstrap] using delegated token from grant <id> (sub=<owner>, act=<delegate>)`) or falls back (logs `[agent-bootstrap] no enroll-agent delegation from <owner> to <delegate> — falling back to direct enroll`). Surfaces during rollout whether the new token-exchange path is firing or whether the IdP's transitive-ownership fallback in `/api/enroll` is still doing the work.

3. **`/api/enroll` transitive-ownership audit**. The fallback that walks the user store to attribute ownership when an agent enrols a sub-agent now logs a structured warning whenever it fires, including the operator command the human should run to set up the proper delegation grant. Same idea: visibility before removal.
