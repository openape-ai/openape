# OpenApe Chat — flows

How a user gets into Chat. Screenshots are captured live from the containerized
E2E stack (`compose/demo/run.sh`) and refreshed on every run.

## One-click SSO

Chat is a DDISA **Service Provider**. A user who already has an IdP session (e.g.
from signing into Troop) lands in Chat with **one click** — same passkey, same
IdP, no second prompt. A first-time user is sent through the IdP's passkey +
consent once, then dropped straight back here.

Chat's start page:

![Chat landing](/docs/screenshots/08-chat-landing.png)

## Chat home

Signed into Chat as `demo@openape.test` via SSO — the conversation home, ready
to talk to people and agents:

![Chat dashboard](/docs/screenshots/09-chat-dashboard.png)
