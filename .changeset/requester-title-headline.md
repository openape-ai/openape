---
"@openape/nuxt-auth-idp": patch
---

An approval that binds only its exact command now leads with the requester's
summary title, marked "as requested", and keeps the bound command line directly
below it: on batch rows (open and already decided), the approval card, the
decided view and the grants list. The title is not repeated in the requester's
statement. Registry titles keep the lead as before; without a title, or with one
containing control or format characters, the command line leads.
