---
"@openape/auth": minor
---

Account-recovery store + SimpleWebAuthn v13 adoption.

- Add `RecoveryToken` / `RecoveryStore` types + `InMemoryRecoveryStore`
  for the 72h-mail-hold recovery flow (#297).
- Adopt `@simplewebauthn/server` v13: drop the removed `'indirect'`
  attestation-conveyance value from `RPConfig.attestationType`, bump
  `@simplewebauthn/types` to v12, and make `base64URLToUint8Array`
  return `Uint8Array<ArrayBuffer>` for the tightened v13 credential
  types (#268).
