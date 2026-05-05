---
'@openape/nuxt-auth-sp': patch
---

`<OpenApeAuth />` form now maps OAuth-error redirect codes to friendly copy via the same default map as `<OpenApeOAuthErrorAlert />` / `useOpenApeOAuthError()`. SPs that mount the form on their landing page (chat, sp-starter) automatically get the friendly message instead of the raw error code. SPs that want a richer banner (UAlert with dismiss-X, product-specific guidance) should drop `<OpenApeOAuthErrorAlert />` directly on the page.
