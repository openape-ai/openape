# Grant brokering between identity providers

Protocol: [Grant Brokering 1.0](https://git.openape.ai/openape-ai/protocol/src/branch/main/grant-brokering.md), introduced by [native protocol PR 1](https://repos.openape.ai/patrick/protocol/pulls/1).

An agent provider hosts agent identities and submits signed requests. A separate decision provider authenticates the human, records consent and signs the original execution grant. Connecting a provider grants permission to submit requests; it does not authorize execution or enable a schedule.

## Server configuration

Both roles use the existing `openape-free-idp` application. Run separate instances with independent persistent databases, signing keys, session secrets and issuer origins. Never share the owner's database or signing key with the agent provider.

The decision provider registers the durable broker store during startup. Startup adds nullable provenance columns to existing grants and creates separate connection, replay, audit and agent-binding tables. Existing rows retain direct-grant behavior. Discovery advertises the profile only after durable storage is available; the generic module has no in-memory production fallback.

For the agent-provider instance, set `NUXT_OPENAPE_IDP_BROKER_AGENT_DOMAIN=pods.openape.ai` and its existing issuer setting to `https://pods.openape.ai`. Configure HTTPS and authoritative DDISA DNS discovery for that exact agent domain. The human's identity domain must likewise resolve to their decision issuer. These are deployment examples, not assertions that the public domain is live. Keep the normal public-registration policy appropriate for a dedicated agent service.

A fresh agent-provider instance must have its own protected session secret and persistent database. Use the established secret and deployment workflows; do not copy the owner IdP environment file. Health and discovery checks must succeed before connecting a real account. Production transport accepts HTTPS and public destinations only, pins the validated DNS address for the TLS connection, and never follows redirects.

## Owner workflow

In Pods, sign in to the owner's DDISA account. In a Pod's **Settings → Pod identity → Agent provider permission**, select **Allow requests from this provider**. Review the exact provider, agent domain and deciding account; select **Confirm permission**. This grants consent through the existing DDISA account; no additional sign-in at the agent provider is needed. Only new Pod identities use this selection. Existing Pods keep their owner, provider, key and grants.

The same connections are visible under **Account & security → Agent providers** at the decision IdP. Revocation blocks requests, token retrieval and further grant consumption, including reusable grants. It cannot recall an already-started command. Reconnecting creates new consent; it does not restore old grants or reassign old agent identities.

Pods obtains a short-lived connection receipt from the owner IdP and enrolls with the agent provider. The owner access token never goes to the agent provider. Agent private keys stay in the local protected connection store. Receipts, access tokens and private keys do not appear in the renderer or chat.

## Execution and scope

The broker authenticates the local agent and signs the entire original grant request with the immutable owner/connection/key binding. The decision provider rejects replay and foreign routing, stores a pending grant without a local agent account, and routes visibility and notifications to its human owner. Existing YOLO and standing-grant shortcuts do not autoapprove brokered requests. Each owner can have at most 100 pending brokered requests across all connections; the check and insertion are atomic. By default, each connection accepts at most 120 outstanding short-lived assertions; the machine-capacity setting below controls this bound. Existing notification debouncing applies. Durable audit rows associate creation, decisions, token issuance and each successful consumption with the owner, agent, broker, connection and grant; they contain no tokens or assertion nonces.

Pods retrieves the original owner-signed authorization token through the agent provider. Its assigned executor checks the pinned decision issuer, original signature, agent subject/key, owner, connection, target host and resolved command. It checks current agent/key status and consumes directly at the decision provider. Unassigned generic CLI execution rejects brokered tokens; it cannot derive a trusted decision authority from a token supplied by an agent.

### Registered requester names

Supporting decision providers advertise `openape_broker_requester_name_supported: true`.
Only then does the agent provider add signed top-level `requester_name` metadata
from the authenticated active agent's registration and matching key. Names are
trimmed, at most 120 Unicode code points and contain no control, format or line
separator characters. Invalid legacy registration names are omitted so display
metadata does not block the existing operation; an invalid signed claim is rejected.
Requester-written summary or origin text never supplies a registered name.

The decision provider stores this display value in `brokered.requester_name` and
uses it beside the stable requester identity. Normal signed create, authorize,
get and token operations refresh names on grants with the same complete broker
binding. A targeted JSON update changes no request, decision, validity or
consumption state; unchanged names cause no row rewrite. Existing pending requests
gain names when the agent next contacts the decision provider. Owner reads use
the stored verified metadata, without a foreign directory lookup or local agent
registration. Missing metadata remains an explicit unavailable-name fallback.

The name is excluded from binding comparisons, authorization decisions and both
AuthZ-JWT and command-token claims. Peers without the exact discovery capability
receive the unchanged assertion format. Deploy both IdP instances to enable the
display extension; no registry reseeding or database schema migration is needed.

## Verification and rollout

Permanent tests cover typed signatures, owner-only decisions, direct-path compatibility, durable replay/single-use/revocation, credential isolation, provider consent and assigned-executor substitution. The packaged UI fixture uses synthetic accounts and does not contact a real provider or activate schedules.

The public agent provider needs a separately configured domain and service. Do not describe local implementation tests as a production federation rollout. Deploy only reviewed canonical source through the existing tested-image pipeline, retain the prior owner-IdP image and database backup, and verify discovery before use.

### Production deployment layout

`compose/chatty.yml` defines `idp` on port 3003 and `pods-idp` on port 3027.
The new instance uses `/home/openape/projects/openape-pods-idp/shared` and the
`PODS_IDP_TAG` pin. Its environment contains independent generated session
secret material and `NUXT_TURSO_URL=file:/home/openape/projects/openape-pods-idp/shared/data/idp.db`.
Set `NUXT_OPENAPE_IDP_ISSUER`, `NUXT_OPENAPE_IDP_RP_ORIGIN` to
`https://pods.openape.ai`, and `NUXT_OPENAPE_IDP_RP_ID`,
`NUXT_OPENAPE_IDP_RP_HOST_ALLOW_LIST`, `NUXT_OPENAPE_IDP_BROKER_AGENT_DOMAIN`
to `pods.openape.ai`. Do not configure mail or Telegram credentials for this instance.

Install `compose/traefik/pods-idp.yml` as its own watched dynamic file. It uses
the existing wildcard TLS certificate and blocks the public human-registration
endpoint. Add `pods` A to the current chatty address and `_ddisa.pods` TXT
`v=ddisa1 idp=https://pods.openape.ai; mode=open` in the authoritative zone.
Back up configuration and the owner's SQLite database before the first deploy.
Confirm the live compose still matches the reviewed baseline before syncing it.

From clean canonical main, run `pnpm deploy:image free-idp pods-idp`. The chatty
connection uses its SSH-config alias (override: `CHATTY_SSH`) and executes Docker
and file installation as the existing `openape` service account. A failed first
deployment is stopped; existing services with a previous image are rolled back.
Keep the retained owner DB backup for explicit recovery; ordinary image rollback
does not replace the live DB or discard grants created after the snapshot.

### Program authorization (`authorize` operation)

`POST /api/grants/authorize` (issue 1473, documented in the nuxt-auth-idp reference) also works for brokered identities. The broker IdP authenticates the agent, checks its binding, validates the body and applies the per-subject authorize budget. It then signs a broker request with `operation: "authorize"`, `sub`, `key_id` and `request` (the unchanged authorize body) to the decision IdP's `openape_brokered_grants_endpoint`.

On the decision IdP, the request goes through the same replay, connection and owner checks as `create`. The decision IdP resolves the call with its own shapes. Only approved grants of the same broker binding cover it; standing grants and pre-approval hooks never decide for brokered identities. A new request is stored with the binding and routed to the owner like `create`. Issued command tokens are audited like `token`.

The decision IdP answers 200 (`approved`), 202 (`pending`) or 403 (`denied`/`revoked`) with the same bodies as the direct endpoint. The broker relays the status and body unchanged. Its transport passes a 403 body through only when it carries such an owner refusal. Each call is one broker assertion. `authorize` and `get` assertions of an agent the connection already holds brokered grants for are bounded per agent (`OPENAPE_RATE_LIMIT_MAX_AUTHORIZE`, default 600 outstanding assertions, which live at most 60 seconds) and together by a ceiling per connection (`OPENAPE_RATE_LIMIT_MAX_BROKER_CALLS`, default ten times the per-agent limit). The decision IdP does not store the agent provider's agent registrations, so an agent without grants of this connection, new or invented, spends the connection-wide `OPENAPE_RATE_LIMIT_MAX_AGENT` budget (below) like all other operations. A 429 carries `Retry-After`, which the broker relays to its caller. Requesters reuse a command token until it expires.

### Machine request capacity

`OPENAPE_RATE_LIMIT_MAX_AGENT` sets both the HTTP machine bucket and the accepted broker-request bound per connection. The default remains 120; invalid or non-positive values retain that default. Broker assertions live for at most 60 seconds, and the durable replay records remain until expiry. Increasing capacity does not skip signature, ownership, grant-status or replay verification.

Assigned CLI calls perform several grant/status checks per invocation. Size the machine limit for the complete automation workload, including active-operation polling. On September 24, 2026, the owner IdP and Pods provider were configured for 600 requests per minute after the real IURIO scan exceeded 120. Keep the strict login bucket separate. Back up the service environment before changing it and verify health plus rate headers afterward.
