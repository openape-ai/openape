---
"@openape/apes": patch
---

apes: `apes agents destroy` now uses `sysadminctl -deleteUser` and runs the IdP DELETE before the long-blocking `apes run --as root --wait`

Two follow-up fixes to the v0.15.0 destroy flow surfaced during real-world use:

- **`dscl . -delete` failed silently** and left orphaned macOS user records. The teardown script wrapped the call in `2>/dev/null || true` so a failure (Open Directory metadata still attached, etc.) was swallowed without trace — the home dir was `rm -rf`'d but `dscl . -read /Users/<n>` still returned a record afterwards. Now the script prefers `sysadminctl -deleteUser` (the canonical macOS API, which also removes Open Directory metadata), falls back to `dscl . -delete` only if `sysadminctl` is missing, propagates failures with a clear stderr message, and post-verifies the record is gone before printing `OK destroyed`.

- **Token-expiry between the two destroy phases** stranded the IdP record when the approver took longer than the access-token TTL to approve the as=root grant. The IdP DELETE on `/api/my-agents/<id>` ran *after* the long-blocking `apes run --as root --wait` call, so for PKCE-only logins (no refresh path) the parent token had already expired by then. Now the IdP DELETE/PATCH happens *before* the escapes call — the token is fresh from preflight, the long approval wait happens after all IdP I/O is done. Idempotency is preserved: re-running destroy on a partially-cleaned agent skips the absent half cleanly.
