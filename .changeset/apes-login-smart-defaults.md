---
'@openape/apes': minor
---

feat(apes): smart defaults for `apes login`

`apes login` now auto-detects all three inputs via a fallback cascade (flag → env → config → derivation):

- **Key:** defaults to `~/.ssh/id_ed25519` when present
- **Email:** extracted from `<key>.pub` comment (set via `ssh-keygen -C <email>`) when the comment contains `@`
- **IdP:** discovered via DDISA DNS (`_ddisa.<email-domain>`) using `resolveDDISA` from `@openape/core`

Happy path becomes:

```
apes login
```

A new `--browser` flag forces the PKCE/browser login even when an SSH key is available. Explicit flags, `APES_KEY`/`APES_EMAIL`/`APES_IDP` env vars, and `~/.config/apes/config.toml` still take precedence over derivation.
