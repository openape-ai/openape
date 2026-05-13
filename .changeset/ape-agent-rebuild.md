---
"@openape/ape-agent": patch
---

Rebuild — `@openape/ape-agent@2.4.0` shipped without the
`backfillHistoryOnce` + `listMessages` code (stale dist). Verified
locally: clean `pnpm build` produces a bundle containing the
backfill paths; the previously published 2.4.0 didn't. No code
change beyond the rebuild.
