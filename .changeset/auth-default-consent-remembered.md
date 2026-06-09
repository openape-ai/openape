---
"@openape/auth": patch
"@openape/nuxt-auth-idp": patch
---

Fix an infinite consent loop for users whose email domain has no DDISA `mode`
(no `_ddisa` record, or a record that omits `mode`). `evaluatePolicy`'s
no-`mode` default returned `'consent'` unconditionally, **ignoring the consent
store** — so after the user approved on the consent screen, `/authorize`
re-evaluated to `'consent'` again and re-prompted forever; the user could never
finish logging in. The default now consults the consent store the same way
`allowlist-user` does: prompt once, then remember the approval (`→ 'allow'`).
The "don't silently issue assertions for an unknown domain" intent is preserved
— the first authorization still prompts.
