---
'@openape/nuxt-auth-idp': minor
---

Rate-limit buckets split by traffic nature (#1073): unauthenticated credential ceremonies stay strict (10/min per IP), `/token` joins the agent bucket (120/min, `OPENAPE_RATE_LIMIT_MAX_AGENT`), and authenticated owner-management APIs (`/api/my-agents`, `/api/users`) get their own bucket (60/min, new `OPENAPE_RATE_LIMIT_MAX_MANAGEMENT`). Machine work from the owner's own IP no longer drains the browser-login budget.
