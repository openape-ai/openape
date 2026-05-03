---
"@openape/apes": patch
---

apes: `apes run --wait` throws a clear "approval timed out" error instead of the misleading "Grant is not approved (status: pending)"

`runAudienceMode`'s wait-loop used to fall through silently on timeout — straight to the token-fetch — and the server then rejected with "Grant is not approved (status: pending)" because… well, it wasn't. Users had no way to tell timeout from a real auth failure.

Two changes:
- Track whether the loop exited via approval (break) or timeout (condition false). On timeout, throw `CliError("Grant approval timed out after Xmin (still pending). Check inbox at <url>…")` instead of falling through.
- Bump the default wait budget from 5 min to 15 min. Human-in-the-loop approvals over phone notifications routinely take longer than 5 min.

Also prints the approval URL right after the grant request so users don't need to dig through their inbox.
