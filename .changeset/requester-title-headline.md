---
"@openape/nuxt-auth-idp": patch
---

An approval that the IdP verifies as binding only its exact command now leads
with the requester's summary title, marked "as requested", and keeps the bound
command line directly below it: on batch rows (open and already decided), the
approval card, the decided view and the grants list. The title is not repeated
in the requester's statement. Grant cards carry the IdP's check as
`card.binds_exact_command`; it fails closed for any other permission, detail
type or argv hash. Registry titles keep the lead as before; without a title, or
with one containing control or format characters, the command line leads.
