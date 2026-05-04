---
'@openape/auth': minor
'@openape/nuxt-auth-idp': minor
---

Enforce DDISA `core.md §5.2.1` `redirect_uri` validation against SP-published metadata (closes #280).

The IdP previously accepted any `redirect_uri` on `/authorize` — only `client_id` was checked for presence. The DDISA spec mandates: SPs MUST publish `/.well-known/oauth-client-metadata` (RFC 7591), and the IdP MUST verify `redirect_uri` against the SP's `redirect_uris` array.

This isn't a centralised registry — it's the same DNS/HTTP-discoverable pattern DDISA uses for IdPs. SP is source-of-truth for its own callbacks; IdP fetches and validates.

Implementation:

- **`@openape/auth`**: new `createClientMetadataResolver()` fetches and caches SP metadata (300s TTL, parallel to DDISA DNS cache). Falls back to legacy `/.well-known/sp-manifest.json` per the spec's migration note. New `validateRedirectUri()` does strict-equality matching (no path-prefix, no wildcards — RFC 6749 §3.1.2.2 + OAuth 2.0 Security BCP).
- **`@openape/nuxt-auth-idp`**: `/authorize` calls the resolver before issuing a code; rejects with 400 on mismatch.

**Rollout-safe defaults**:

- `spMetadataMode: 'permissive'` (default) tolerates unresolvable SP metadata so existing SPs keep working while they catch up. Explicit redirect_uri MISMATCH is always rejected though — permissive only forgives missing metadata.
- `spMetadataMode: 'strict'` once all SPs publish: also rejects unresolvable.
- Native CLIs (RFC 8252 public clients) without a domain go through a static `publicClients` map — `apes-cli` registered for the `localhost:9876` callback.

Env vars: `NUXT_OPENAPE_IDP_SP_METADATA_MODE`, `NUXT_OPENAPE_IDP_PUBLIC_CLIENTS` (JSON).

Follow-up: each OpenApe SP (chat, plans, tasks, preview) needs to publish its `oauth-client-metadata` file before strict mode can be enabled. Tracked separately.
