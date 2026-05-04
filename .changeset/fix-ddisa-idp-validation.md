---
'@openape/core': minor
---

Validate the DDISA `idp=` URL on parse (closes #281).

`parseDDISARecord` previously accepted any string after `idp=`: `http://`, `javascript:`, IDN homograph hostnames, paths with embedded credentials. The IdP URL is the trust anchor for the entire DDISA flow — every SP that resolves it fetches JWKS from there and accepts the resulting assertions, so a poisoned DNS record (cache poisoning, on-path attacker, hostile registrar/registrant for a sub-tenant, dev environments without DNSSEC) redirected every login through an attacker IdP that the SP would happily trust.

The parser now rejects records whose `idp=` value isn't:

- a parseable URL,
- with `https:` protocol (or `http:` when `OPENAPE_DDISA_ALLOW_HTTP=1` is set — strictly a dev escape hatch),
- without embedded credentials (`user:pass@`),
- printable-ASCII only (defends against IDN homographs + RTL-override + null-byte injection — punycode hostnames are fine, they're already ASCII).

Five new tests pin each rejection class plus the dev-env escape hatch. Existing-record happy-path tests are unchanged: the original input string is returned untouched (no URL re-normalisation), so a record that was being read correctly before is still being read correctly.
