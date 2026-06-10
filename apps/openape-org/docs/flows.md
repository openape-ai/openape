# OpenApe Org — flows

How a user gets into Org. Screenshots are captured live from the containerized
E2E stack (`compose/demo/run.sh`) and refreshed on every run.

## DDISA SSO login

Org is a DDISA **Service Provider**. A user signs in with the same passkey +
IdP as everywhere else — Org discovers the IdP from the user's email domain
and redirects them to authorize; an existing IdP session makes it one click.

Org's start page (the sign-in is right there — no extra login hop):

![Org start page](/docs/screenshots/10-org-landing.png)

## Org home

Signed in as `demo@openape.test` — the organization home, where the CEO-led
agent organization lives (vision, team, budget, reports):

![Org home](/docs/screenshots/11-org-home.png)
