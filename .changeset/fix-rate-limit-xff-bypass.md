---
'@openape/nuxt-auth-idp': minor
---

Fix rate-limit bypass via spoofed `X-Forwarded-For` header (closes #279).

The IdP rate-limit on `/api/(session|auth|agent|webauthn)`, `/authorize`, and `/token` was keyed on `getRequestIP(event, { xForwardedFor: true })`. h3 returns the **leftmost** XFF value, which is attacker-controllable on every deployment topology that doesn't strip incoming XFF — including Vercel in many configs. Rotating the header per request let attackers slip past the 10/min cap and brute-force agent challenges, WebAuthn assertions, and enrol endpoints.

The plugin now keys on the socket peer by default. Operators behind a real proxy fleet opt in by setting `OPENAPE_RATE_LIMIT_TRUSTED_PROXIES` to a comma-separated CIDR list; when the request's direct peer is in that list the plugin walks the XFF chain right-to-left and returns the first non-trusted IP — the actual client. Attacker-injected leftmost values are now ignored.

11 new unit tests pin CIDR matching + the right-to-left walk + the default-safe behaviour. The IPv4 CIDR matcher is small and inlined; IPv6 CIDR is a future improvement (matched literally for now).
