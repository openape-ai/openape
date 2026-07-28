# OpenApe CEO Telegram flow

The CEO Telegram flow gives the Owner a mobile entry point into an OpenApe Org. A Telegram message from the Owner becomes a CEO conversation, and the CEO either answers directly or turns the request into PM triage work for the org team.

## Participants

- **Owner** — sends the Telegram message and approves high-risk or budget-relevant decisions.
- **Telegram bridge** — receives the Telegram update, authenticates the sender mapping, and forwards the message into the OpenApe agent runtime.
- **CEO agent** — the org-level executive persona. It reads the org vision, members, objectives, reports and cost context before answering.
- **pm-orchestrator / PM-Triage** — decomposes approved CEO objectives into concrete work items, assigns them to specialists and reports status back to the CEO.
- **Specialists** — implement assigned work in their lane and report through PM-Triage rather than directly replacing CEO decisions.
- **Sanierer** — watches budget and output/cost health independently of the CEO and escalates threshold breaches to the Owner.

## End-to-end flow

1. **Telegram receives the Owner message.**
   The Owner writes to the configured Telegram bot or chat. The bridge accepts messages only from mapped Owner identities; unknown senders are ignored or rejected.

2. **The bridge forwards a CEO chat turn.**
   The bridge posts the text as a chat message to the Owner's org CEO agent. The forwarded context includes the org identity and the Owner identity so the CEO can ground the reply in the correct organization.

3. **The CEO refreshes org context.**
   The CEO treats every turn as stateless. Before answering it reads the live company source of truth: vision, members, objectives, reports and recent cost snapshots from `troop.openape.ai`.

4. **The CEO classifies the request.**
   - If the Owner asks for status, priorities, budget or a proposal, the CEO answers directly with the current facts and a recommended next step.
   - If the Owner asks for execution, the CEO turns the request into an objective or PM handoff and asks for approval when needed.
   - If the request needs technical design, implementation detail or specialist judgment, the CEO delegates through PM-Triage instead of deciding it alone.

5. **PM-Triage decomposes approved work.**
   pm-orchestrator / PM-Triage turns the CEO-approved objective into actionable tasks, assigns the right personas and tracks blockers. Status flows back to the CEO so the Owner can continue using Telegram as the single executive interface.

6. **The CEO replies to Telegram.**
   The CEO response is sent back through the Telegram bridge. Good responses are brief, concrete and grounded in current rows: what is true now, what the CEO recommends, and what needs Owner approval.

## Triggers and expected responses

| Telegram input | Expected CEO behavior |
| --- | --- |
| "What is happening this week?" | Summarize open objectives, recent reports, blockers and budget signals. |
| "Can we ship X?" | Propose an objective, success criteria, likely team roles and cost/risk notes. Ask for approval before creating or delegating work. |
| "Do it" / "Start this" | Confirm the interpreted objective, then hand it to PM-Triage if it is approved and in scope. |
| "Who should build this?" | Recommend role structure and cost. Do not make specialist-level technical design decisions. |
| Budget, hiring or access changes | State the risk and ask for explicit Owner approval. The Sanierer remains an independent budget guardrail. |
| Secrets, auth, payments, migrations, deletion or deploy/CI changes | Stop and escalate for explicit Owner decision; do not self-approve. |

## Guardrails

- **Stateless by default.** The CEO does not rely on memory. If it cannot re-read a fact from org data, reports, objectives or tasks, it treats the fact as unknown.
- **Owner approval for material changes.** New objectives, hiring, budget changes and high-risk work require explicit Owner approval.
- **CEO stays executive.** The CEO interprets vision, proposes objectives and reports status. Technical design and implementation belong to Teamleads and Specialists.
- **PM-Triage owns decomposition.** PM-Triage creates and routes concrete work items after the CEO/Owner direction is clear.
- **Sanierer is independent.** Budget and output/cost concerns can bypass the CEO and go directly to the Owner.
- **Telegram is an interface, not a source of truth.** Durable state belongs in org data, objectives, reports and tasks; Telegram messages are conversational input/output.

## Operational checklist

When the flow is configured for an org, verify:

- The Telegram sender is mapped to the correct Owner identity.
- The Telegram bridge routes messages to the intended org CEO agent.
- The CEO can read the org API for vision, members, objectives, reports and costs.
- PM-Triage is available for approved execution work.
- High-risk requests are escalated instead of executed from chat alone.
- The final Telegram reply includes either the answer, the requested approval, or the handoff status.
