---
'@openape/chat': patch
---

Canonicalise email casing in `resolveCaller` (closes #282).

Contacts canonicalised to lowercase but `messages.senderEmail`, `memberships.userEmail`, and edit-ownership checks (`existing.senderEmail !== caller.email`) used `caller.email` as-is from the JWT `sub`. If two casings of the same address ever co-existed (different IdP behaviour, re-issued accounts), they'd be treated as separate identities — `Foo@x.com` user added to a room would appear next to a `foo@x.com` contact, the bridge allowlist (lower-cased) would diverge from server-side membership rows, and authz checks would silently disagree.

`resolveCaller` now lower-cases the email exactly once at the boundary — every downstream comparison sees the same string regardless of how the IdP emitted the casing. Two regression tests for the cookie + bearer paths.
