---
'@openape/core': minor
'@openape/grants': minor
'@openape/nuxt-auth-idp': minor
'@openape/apes': minor
---

Add owner-published shapes (issue 1551). A signed-in human owner publishes the
adapter of a tool they built (`PUT /api/shapes/{cliId}`, `?dry_run=1` to
preview, `DELETE`, `GET /api/shapes?mine=1`, IdP page `/shapes`,
`apes shapes publish|list --mine|remove`). The IdP resolves the program calls of
that owner's direct agents with the owner's shapes after every registry shape;
an owner shape never takes a registry id or executable, never counts as a
tested version and is never used for other accounts or brokered identities.
The IdP records the shape owner in `execution_context.adapter_owner`; clients
cannot write it. Unlike registry shapes, an owner shape binds its continuing
grants by digest: republishing, removing it or a registry shape that later
takes over the program asks again. The grant card marks the owner shape and
lists every operation it declares. `assertResourceChainTemplates` rejects
resource chains the matcher could not render when a shape is published.
