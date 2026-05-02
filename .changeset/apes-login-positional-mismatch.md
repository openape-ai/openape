---
"@openape/apes": minor
---

apes: `apes login <email>` accepts the email as a positional argument, and DDISA mismatches refuse to log in unless `--force` is passed

Two UX improvements to `apes login`:

- **Positional email**: `apes login patrick@hofmann.eco` now works directly. The legacy `--email` flag stays around as an alias.
- **DDISA mismatch guard**: when an explicit `--idp` (or `APES_IDP` env, or `defaults.idp` in config.toml) selects a different IdP than the email's domain DDISA record points at, the login refuses with a clear diagnostic. Pass `--force` to bypass. This catches the foot-gun where `apes login --idp https://id.openape.at` produces a token that downstream SPs (e.g. `preview.openape.ai`, `chat.openape.ai`) reject with "IdP mismatch" because they trust the DDISA-resolved IdP instead. Auto-discovered IdPs (no explicit override) bypass the guard since by definition they can't mismatch.
