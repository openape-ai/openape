---
'@openape/nest': minor
'@openape/apes': minor
---

Nest API now requires DDISA grant tokens for read endpoints. `apes nest list` and `apes nest status` go through the grant flow: request a `nest list`/`nest status` grant (audience `nest`), reuse any existing approved 'always'/'timed' grant for the exact same command, otherwise prompt the human once with `grant_type: 'always'` so subsequent calls reuse silently. The grant token is presented as `Authorization: Bearer …` to the Nest, which verifies it against the IdP's JWKS and matches the embedded `command` claim against the route. Each call leaves an audit record at the IdP. Mutating endpoints (POST /agents, DELETE /agents/:name) keep the unauthenticated path for now — gated in the next release. New audience `nest` registered in the audience-bucket whitelist (commands bucket).
