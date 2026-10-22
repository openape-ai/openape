---
"@openape/ape-secrets": minor
"@openape-secrets/app": minor
---

Add the passkey vault flow to `ape-secrets`: `request --secret NAME` asks the owner's vault, `wait` reports the approval, and `deliver` collects it and hands the value straight to a file (0600), a command's stdin or one environment variable without ever printing it. The CLI pins the vault key on first use and checks every package signature before decrypting. The legacy `--field` request and `fetch` keep working.
