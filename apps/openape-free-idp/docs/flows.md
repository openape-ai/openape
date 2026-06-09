# OpenApe IdP — flows

How a user gets an identity on this DDISA Identity Provider. Screenshots are
captured live from the containerized E2E stack (`compose/demo/run.sh`) and
refreshed on every run.

## Passkey sign-up

A new user registers a **WebAuthn passkey** — no password. The IdP becomes the
DDISA authority for their identity; Service Providers (Troop, Chat, …) then log
them in via DNS-discovered SSO without ever seeing a credential.

The IdP landing page (enter your email to start):

![IdP landing](/docs/screenshots/01-idp-landing.png)

A registration link is issued (the email a real user receives):

![Registration link](/docs/screenshots/02-idp-request-link.png)

Registering the passkey (`/register?token=…`) — a CDP virtual authenticator
answers the ceremony headlessly in the E2E run:

![Passkey registration](/docs/screenshots/03-idp-register-passkey.png)

## Account dashboard

Signed in — the IdP account dashboard, where the user manages passkeys, agents,
permissions and connected services:

![IdP dashboard](/docs/screenshots/04-idp-registered.png)
