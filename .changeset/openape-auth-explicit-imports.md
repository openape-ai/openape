---
'@openape/nuxt-auth-sp': patch
---

Fix: `<OpenApeAuth />` blew up with `useOpenApeAuth is not defined` for SPs that consume the module from npm. The component relied on Nuxt's unimport to inject auto-imports into its `<script setup>`, but unimport doesn't reliably transform `.vue` files inside `node_modules` — same class of bug we fixed on the IdP side for the `/consent` page. Explicit imports from `#imports` make the component work for both workspace and npm consumers.

Discovered via the sp-starter dry-run at test.deltamind.at: a fresh `pnpm install` + `pnpm dev` + visit `/login` returned 500 instead of rendering the form.
