---
"@openape/grants": patch
"@openape/nuxt-auth-idp": patch
---

A broker now relays a command token from `POST /api/grants/authorize` up to
`PROGRAM_AUTHORIZE_LIMITS.tokenChars` (120 KiB). Before, it refused tokens over
16 KiB with 503. A command token repeats the argv, so a program call with a
few kilobytes of arguments already exceeded that limit (issue 1476). The
decision IdP answers a command whose token would be larger with a definite 413
`command_too_large`, and it does not spend a single-use grant. Brokers relay
that 413.

`POST /api/grants/authorize` logs unexpected 5xx failures with a request id,
the program name and the resolved operation, and never the arguments. The
problem answer carries the same id as `request_id`.

Coverage and reuse ignore stored authorization details that lack a field they
compare (`isCoverableCliDetail`, `coverableCliDetails`). Before, such a detail
could fail the request with 500.
