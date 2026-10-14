---
"@openape/core": minor
"@openape/grants": minor
"@openape/nuxt-auth-idp": minor
---

Add per-call program authorization (issue 1473). The endpoint is
`POST /api/grants/authorize`. A requester sends the program name, the SHA-256
of the program file, the exact arguments, the target host and an optional
summary. The IdP then performs these steps:

- It selects the shape by tested digest, or else by executable name with
  `version_tested: false`.
- It resolves the command itself and writes `execution_context`.
- It answers 200 with a command token when an approved or standing grant
  covers the call. The token is bound to `argv_hash` and `program_sha256`
  and lasts at most five minutes. Issuing it spends a single-use grant;
  the first `/consume` with that token answers `consumed`, every replay
  `already_consumed`.
- Otherwise it answers 202 with one pending request, reused across calls.
- It answers 403 when the owner denied or revoked this permission.

Brokered identities reach their decision IdP through the new signed broker
operation `authorize` with the same body and answer. Calls have their own
per-subject rate limit, set with `OPENAPE_RATE_LIMIT_MAX_AUTHORIZE` (default
600/min), and leave the per-IP buckets alone.

`@openape/grants` adds `parseProgramAuthorizeRequest`, `selectProgramShape`,
`resolveProgramCall`, `issueCommandJWT` and `ServerShape.tested_digests`. The
generic server fallback now binds `computeArgvHash`, the same argv hash that
apes uses.

The grant card renders IdP-resolved grants without a client adapter digest. It
shows "version not tested" for untested program versions and now also
appears for brokered grants. `POST /api/grants` refuses the IdP-only
`execution_context.program_sha256` and `version_tested`.
