---
'@openape/nuxt-auth-idp': patch
---

Fix: clicking "Anmelden" on the consent screen showed "Server did not return a redirect target." instead of completing the SP-login.

`consent.post` previously returned a `302 sendRedirect` and the page tried to read the `Location` header from a `fetch({ redirect: 'manual' })` response. Browsers turn 3xx responses under `redirect: 'manual'` into opaque-redirect responses whose headers are unreadable per the Fetch spec — so the consent page could never get the location. Now the handler returns `{ location: '...' }` JSON and the page does a top-level `window.location.assign`. Same trust boundary; same hop sequence; just survives the Fetch spec.
