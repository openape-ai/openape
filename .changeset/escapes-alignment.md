---
'@openape/apes': minor
---

Align apes with the escapes naming and MIT-relicensed escapes repo:

- `APES_IDP` is now the canonical env var for the IdP URL. `GRAPES_IDP`
  remains as a deprecated alias — it still works, but emits a warning.
  When both are set, `APES_IDP` wins.
- OAuth `CLIENT_ID` used in the PKCE login flow is renamed from
  `grapes-cli` to `apes-cli`. `openape-free-idp` accepts any client id,
  so this is transparent there. Third-party IdPs with strict client
  allowlists need to register `apes-cli` (a transitional phase
  accepting both is recommended).
- `ape-shell` now rejects bare `sudo <cmd>` lines with a clear hint
  pointing at `apes run --as root -- <cmd>`, which routes through the
  escapes setuid binary and requires a fresh grant per invocation.
  Compound lines still fall through to the generic session-grant path.
