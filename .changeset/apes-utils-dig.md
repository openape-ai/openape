---
"@openape/apes": minor
---

apes: new `apes utils …` namespace for admin/diagnostic tools, kicked off with `apes utils dig <domain|email>`

`apes utils dig patrick@hofmann.eco` strips the local part, looks up the DDISA TXT record at `_ddisa.<domain>`, prints the parsed fields (issuer, mode, priority), and probes the resolved IdP via OIDC discovery. Same data as `apes dns-check` plus email-stripping and `--json` output. Future home for token decoders, config dumpers, version reporters that don't fit the grants/agents/auth namespaces.

`apes dns-check` is unchanged for backward compatibility.
