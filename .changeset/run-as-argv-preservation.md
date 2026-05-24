---
"@openape/apes": patch
---

fix(run --as): preserve argv for wrapped commands with metacharacters

`apes run --as <user> -- <cmd>` flattened the wrapped command to a string
(`command.join(' ')`) and `runAudienceMode` re-split it on spaces, which
shattered any argument containing spaces or shell metacharacters. The
nest's capability-secret relay runs
`apes run --as <agent> -- sh -c "mkdir … && cat > …"`, so its script was
mangled and escapes rejected the broken argv with exit 64 — meaning
sealed secrets (e.g. GH_TOKEN) never reached the agent. The escapes path
now carries the original argv through intact; the joined string is kept
only for the human-readable grant display. (Latent until now: secret
binding was impossible before agents reported their X25519 key, so this
relay path had never actually run in production.)
