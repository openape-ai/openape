---
"@openape/core": minor
---

Add anonymous X25519 sealed-box (`seal`, `open`, `openString`,
`generateX25519KeyPair`). Pure `node:crypto` (X25519 ECDH → HKDF-SHA256 →
AES-256-GCM), no external dependency. Used to encrypt agent secrets to a
recipient's public key so only the holder of the matching private key can
decrypt them.
