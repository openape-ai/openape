# Troop — flows

How Troop, OpenApe's agent control plane, is used end-to-end. Screenshots are
captured live from the containerized E2E stack (`compose/agent/run.sh` +
`compose/demo/run.sh`) and refreshed on every run.

## DDISA SSO login

Troop is a DDISA **Service Provider**. A user opens Troop, which discovers the
user's IdP from a DNS `_ddisa` TXT record and redirects them to authorize — no
password, no per-SP account.

Troop's start page (the login email is right there):

![Troop landing](/docs/screenshots/05-troop-landing.png)

The DDISA consent screen at the IdP — Troop is asking to use the user's
identity (shown once, then remembered):

![DDISA consent](/docs/screenshots/06-idp-authorize-troop.png)

Back on Troop, authenticated — the agents dashboard:

![Troop dashboard](/docs/screenshots/07-troop-dashboard.png)

## Agent lifecycle — spawn → run → destroy

The full control-plane round-trip: a **nest** daemon binds to Troop, then an
agent is spawned, run (it answers a chat message through its LLM), and
destroyed — all driven through Troop.

Spawned — the agent appears in the dashboard:

![Agent spawned](/docs/screenshots/agent-01-spawned.png)

Run — the owner sends a message and the agent replies through Troop; the
reply proves the spawn → bridge → LLM → reply path end-to-end:

![Agent ran](/docs/screenshots/agent-02-ran.png)

Destroyed — the agent is torn down and the dashboard is empty again:

![Agent destroyed](/docs/screenshots/agent-03-destroyed.png)
