# ceo recipe

The top-tier agent for an OpenApe Org (`org.openape.ai`). One CEO per
organization. The Owner chats with the CEO, the CEO interprets vision
into Objectives, proposes team structure, and reports status — all
grounded in live org.openape.ai data.

## v0.1 scope (this version)

**Read-only.** CEO can fetch everything about the org but cannot write
anything back. It proposes; the Owner approves verbally; v0.2 lands
write capability so proposals become real Objective/Report rows.

This deliberately small first step exists to validate that:
- CEO grounds its answers in real data (not hallucinated)
- Owner chat UX is good enough to be "the one interface"
- Stateless re-reads stay fast enough to feel live

See plan https://plans.openape.ai/01KSYCHBQ7WNE5GS338PH89DFM for the
full M0–M5 roadmap (M0 = org.openape.ai SP, M1 = this recipe).

## Deploy

```bash
apes agent deploy github.com/openape-ai/recipes/ceo@v0.1.0 \
  --param org_id=$ORG_ID \
  --param org_name="OpenApe Inc." \
  --secret ORG_API_TOKEN=$(apes token print --aud apes-cli) \
  --secret ORG_API_BASE=https://org.openape.ai
```

For local dev:

```bash
apes agent deploy ./examples/agent-recipes/ceo \
  --param org_id=$ORG_ID \
  --param org_name="OpenApe Inc." \
  --secret ORG_API_TOKEN=$(apes token print --aud apes-cli) \
  --secret ORG_API_BASE=http://host.docker.internal:3020
```

## Chat with the CEO

After deploy the CEO appears in troop (`troop.openape.ai/agents/ceo`).
Open the chat tab and ask things like:

- "What's our current vision?"
- "What objectives are open right now?"
- "How is the team doing this month?"
- "Propose 5 objectives we could ship next quarter."
- "What would it cost to hire a Teamlead + 2 Implementers?"

The CEO will fetch fresh data from `org.openape.ai` and answer with
specifics. If it tries to wax abstract, prompt it with "be specific
and quote the row" — the system prompt is tuned for concreteness but
LLMs drift.

## What the CEO will NOT do

- Make technical design decisions ("React vs Vue", "Postgres vs SQLite")
- Write code or open PRs
- Spawn other agents (lands in v0.2)
- Write to the org.openape.ai API (lands in v0.2)
- Filter bad news from the Owner

## What's next

- **v0.2**: write capability — CEO PUTs Objectives + Reports
- **v0.3**: spawn capability — CEO calls troop's `/api/agents/spawn-intent`
  to actually hire its proposed team (within budget; over-budget escalates
  to Owner via DDISA grant)
- **v0.4**: Friday weekly-report cron task
