---
'@openape/core': minor
'@openape/nuxt-auth-sp': patch
---

Normalize the polymorphic DDISA `act` claim through one shared helper.

`@openape/core` gains `normalizeActClaim(act: unknown): 'human' | 'agent'`:
only the literal string `'human'` yields `'human'`; an RFC 8693 delegation
object (`{sub}`) and everything else (absent claim, unknown strings,
malformed objects) fail closed to `'agent'`. A delegated actor must never
be classified as an unrestricted human.

`@openape/nuxt-auth-sp` now uses the helper in `requireCaller`, the CLI
exchange handlers, and the agent-token fallback, so a subject token whose
`act` is a delegation object mints/reports `act='agent'` instead of
`'human'`.
