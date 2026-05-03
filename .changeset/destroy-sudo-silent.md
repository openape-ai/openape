---
"@openape/apes": minor
---

`apes agents destroy` now uses sudo + a silent password prompt instead of `apes run --as root` + a visible password prompt. One credential, one interaction. The DDISA grant approval was redundant: sysadminctl required the local admin password regardless. The previous `consola.prompt({ mask: '*' })` showed the password in plaintext on terminals (Warp, etc.) where the mask option is ignored — replaced with native raw-mode stdin that disables echo entirely. `APES_ADMIN_PASSWORD` env var still works for non-interactive use.
