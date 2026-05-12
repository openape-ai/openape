---
"@openape/nuxt-auth-sp": minor
---

`nuxt-auth-sp` hardcoded `/dashboard` as the post-login destination in two places (server-side OIDC callback + client-side already-signed-in fast-path). That assumption fits openape-chat (which has a `/dashboard.vue`) but breaks openape-troop (which doesn't — its root is the agent list at `/`). Users completing OIDC at id.openape.ai landed on a 404.

Both paths now read from a new `openapeSp.postLoginRedirect` module option (default `/dashboard` for back-compat). The `<OpenApeAuth>` component takes a matching `post-login-redirect` prop so SPs can wire the client-side fast-path explicitly. troop's nuxt.config + login.vue now point to `/`.
